//! Único lugar que monta comandos do FFmpeg e do ffprobe e interpreta a saída.
//!
//! - Argumentos são montados por funções nomeadas (`probe_args`, `poster_args`) e testados.
//! - Os binários são sidecars (`src-tauri/binaries/`, copiados ao lado do executável pelo
//!   Tauri); se não existirem, cai para o `ffmpeg` do PATH (desenvolvimento fora do Windows).
//! - Processos rodam com prioridade reduzida e sem janela de console no Windows.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};

use crate::time::{seconds_str_to_us, Rational};

/// Caminho do binário `name` ("ffmpeg" ou "ffprobe").
pub fn binary(name: &str) -> PathBuf {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        let candidate = dir.join(&file);
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(file)
}

/// Argumentos comuns a todo ffmpeg do app.
fn base_args() -> Vec<OsString> {
    ["-hide_banner", "-nostdin", "-loglevel", "error"]
        .iter()
        .map(OsString::from)
        .collect()
}

pub fn probe_args(input: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    args.push(input.as_os_str().to_owned());
    args
}

/// Um quadro em `at_us`, com largura `width` (altura proporcional e par), em JPEG.
/// `-ss` antes de `-i` faz seek rápido por keyframe; em 0 ele fica de fora, porque com
/// `-ss 0` o FFmpeg 6 não entrega nenhum quadro de um JPEG (a foto ficava sem pôster).
/// `rotate` (graus no sentido horário) gira explicitamente, sem a rotação automática do
/// FFmpeg: usado nas fotos com giro no EXIF, que nem toda versão do FFmpeg aplica.
pub fn poster_args(
    input: &Path,
    output: &Path,
    at_us: i64,
    width: u32,
    rotate: Option<u16>,
) -> Vec<OsString> {
    let mut args = base_args();
    let turn = match rotate {
        Some(90) => "transpose=1,",
        Some(180) => "hflip,vflip,",
        Some(270) => "transpose=2,",
        _ => "",
    };
    if !turn.is_empty() {
        args.push("-noautorotate".into());
    }
    if at_us > 0 {
        args.extend(["-ss".into(), format_seconds(at_us).into()]);
    }
    args.push("-i".into());
    args.push(input.as_os_str().to_owned());
    args.extend(
        ["-frames:v", "1", "-an", "-vf"]
            .iter()
            .map(OsString::from)
            .chain([
                OsString::from(format!("{turn}scale={width}:-2")),
                "-q:v".into(),
                "4".into(),
                "-y".into(),
            ]),
    );
    args.push(output.as_os_str().to_owned());
    args
}

/// µs → "12.345678" (sem notação científica, como o FFmpeg espera).
pub fn format_seconds(us: i64) -> String {
    let sign = if us < 0 { "-" } else { "" };
    let us = us.unsigned_abs();
    format!("{sign}{}.{:06}", us / 1_000_000, us % 1_000_000)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
}

/// Espelha `MediaProbe` de src/project/types.ts.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<Rational>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variable_frame_rate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<u16>,
}

#[derive(Deserialize)]
struct RawProbe {
    #[serde(default)]
    streams: Vec<RawStream>,
    format: Option<RawFormat>,
}

#[derive(Deserialize)]
struct RawFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

#[derive(Deserialize, Default)]
struct RawStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    duration: Option<String>,
    sample_rate: Option<String>,
    channels: Option<u32>,
    #[serde(default)]
    disposition: RawDisposition,
    #[serde(default)]
    tags: std::collections::HashMap<String, String>,
    #[serde(default)]
    side_data_list: Vec<serde_json::Value>,
}

#[derive(Deserialize, Default)]
struct RawDisposition {
    #[serde(default)]
    attached_pic: u8,
}

const IMAGE_CODECS: &[&str] = &[
    "png", "mjpeg", "webp", "bmp", "tiff", "gif", "jpegls", "jpeg2000",
];

/// Diferença relativa acima da qual r_frame_rate e avg_frame_rate indicam VFR.
/// 0,2%: celulares em VFR costumam marcar 30/1 contra média de ~29,87 (0,4%).
const VFR_TOLERANCE: f64 = 0.002;

fn rotation_of(stream: &RawStream) -> Option<u16> {
    let from_side_data = stream
        .side_data_list
        .iter()
        .find_map(|s| s.get("rotation").and_then(serde_json::Value::as_f64));
    let from_tag = stream
        .tags
        .get("rotate")
        .and_then(|v| v.parse::<f64>().ok())
        .map(|r| -r);
    // ffprobe informa a rotação da matriz (anti-horária); o vídeo deve ser girado no sentido oposto.
    let raw = from_side_data.or(from_tag)?;
    let deg = ((-raw).round() as i64).rem_euclid(360) as u16;
    match deg {
        0 => None,
        90 | 180 | 270 => Some(deg),
        _ => None,
    }
}

/// Interpreta a saída JSON do ffprobe. Devolve o tipo da mídia e o probe.
pub fn parse_probe(json: &str) -> Result<(MediaKind, MediaProbe), String> {
    let raw: RawProbe =
        serde_json::from_str(json).map_err(|e| format!("saída do ffprobe inválida: {e}"))?;
    let format_name = raw
        .format
        .as_ref()
        .and_then(|f| f.format_name.clone())
        .unwrap_or_default();

    let video = raw
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video") && s.disposition.attached_pic == 0);
    let audio = raw
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"));

    let is_image = video.is_some_and(|v| {
        let codec = v.codec_name.as_deref().unwrap_or("");
        IMAGE_CODECS.contains(&codec)
            && audio.is_none()
            && (format_name.contains("image2")
                || format_name.ends_with("_pipe")
                || format_name == "gif")
    });

    let kind = match (video, audio) {
        _ if is_image => MediaKind::Image,
        (Some(_), _) => MediaKind::Video,
        (None, Some(_)) => MediaKind::Audio,
        (None, None) => return Err("o arquivo não tem vídeo nem áudio".into()),
    };

    let duration = raw
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(seconds_str_to_us)
        .or_else(|| {
            video
                .and_then(|v| v.duration.as_deref())
                .and_then(seconds_str_to_us)
        })
        .or_else(|| {
            audio
                .and_then(|a| a.duration.as_deref())
                .and_then(seconds_str_to_us)
        })
        .unwrap_or(0);

    let mut probe = MediaProbe {
        duration: if kind == MediaKind::Image {
            0
        } else {
            duration
        },
        ..Default::default()
    };

    if let Some(v) = video {
        probe.width = v.width;
        probe.height = v.height;
        probe.video_codec = v.codec_name.clone();
        probe.rotation = rotation_of(v);
        if kind == MediaKind::Video {
            let r = v.r_frame_rate.as_deref().and_then(Rational::parse);
            let avg = v.avg_frame_rate.as_deref().and_then(Rational::parse);
            probe.fps = avg.or(r);
            if let (Some(r), Some(avg)) = (r, avg) {
                let (r, avg) = (r.as_f64(), avg.as_f64());
                probe.variable_frame_rate = Some((r - avg).abs() / r > VFR_TOLERANCE);
            }
        }
    }
    if let Some(a) = audio {
        probe.audio_codec = a.codec_name.clone();
        probe.sample_rate = a.sample_rate.as_deref().and_then(|s| s.parse().ok());
        probe.channels = a.channels;
    }
    Ok((kind, probe))
}

/// Cria o processo com prioridade reduzida e, no Windows, sem janela de console.
fn command(bin: &Path, args: &[OsString]) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    cmd
}

async fn run(bin: &Path, args: &[OsString]) -> Result<Vec<u8>, String> {
    let output = command(bin, args)
        .output()
        .await
        .map_err(|e| format!("não foi possível executar {}: {e}", bin.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("erro desconhecido");
        return Err(msg.trim().to_string());
    }
    Ok(output.stdout)
}

pub async fn probe(input: &Path) -> Result<(MediaKind, MediaProbe), String> {
    let stdout = run(&binary("ffprobe"), &probe_args(input)).await?;
    parse_probe(&String::from_utf8_lossy(&stdout))
}

pub async fn poster(
    input: &Path,
    output: &Path,
    at_us: i64,
    width: u32,
    rotate: Option<u16>,
) -> Result<(), String> {
    if let Some(dir) = output.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| e.to_string())?;
    }
    // Grava num temporário e renomeia: um pôster pela metade nunca aparece.
    let tmp = output.with_extension("tmp.jpg");
    run(
        &binary("ffmpeg"),
        &poster_args(input, &tmp, at_us, width, rotate),
    )
    .await?;
    tokio::fs::rename(&tmp, output)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strs(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn seconds_format() {
        assert_eq!(format_seconds(0), "0.000000");
        assert_eq!(format_seconds(12_345_678), "12.345678");
        assert_eq!(format_seconds(1), "0.000001");
        assert_eq!(format_seconds(-500_000), "-0.500000");
    }

    #[test]
    fn probe_command() {
        assert_eq!(
            strs(&probe_args(Path::new("C:/Vídeos/a b.mp4"))),
            [
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                "C:/Vídeos/a b.mp4"
            ]
        );
    }

    #[test]
    fn poster_command() {
        let args = strs(&poster_args(
            Path::new("in.mov"),
            Path::new("out.jpg"),
            9_500_000,
            320,
            None,
        ));
        assert_eq!(
            args,
            [
                "-hide_banner",
                "-nostdin",
                "-loglevel",
                "error",
                "-ss",
                "9.500000",
                "-i",
                "in.mov",
                "-frames:v",
                "1",
                "-an",
                "-vf",
                "scale=320:-2",
                "-q:v",
                "4",
                "-y",
                "out.jpg"
            ]
        );
        // -ss vem antes de -i (seek rápido).
        assert!(args.iter().position(|a| a == "-ss") < args.iter().position(|a| a == "-i"));
    }

    #[test]
    fn poster_of_rotated_photo_turns_explicitly() {
        let args = strs(&poster_args(
            Path::new("foto.jpg"),
            Path::new("out.jpg"),
            0,
            320,
            Some(90),
        ));
        // Instante 0 (fotos): sem -ss.
        assert!(!args.contains(&"-ss".to_string()));
        let noauto = args.iter().position(|a| a == "-noautorotate").unwrap();
        assert!(noauto < args.iter().position(|a| a == "-i").unwrap());
        assert!(args.contains(&"transpose=1,scale=320:-2".to_string()));
        let upside = strs(&poster_args(
            Path::new("a"),
            Path::new("b"),
            0,
            320,
            Some(180),
        ));
        assert!(upside.contains(&"hflip,vflip,scale=320:-2".to_string()));
        let left = strs(&poster_args(
            Path::new("a"),
            Path::new("b"),
            0,
            320,
            Some(270),
        ));
        assert!(left.contains(&"transpose=2,scale=320:-2".to_string()));
    }

    const PHONE_VIDEO: &str = r#"{
      "streams": [
        { "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
          "r_frame_rate": "30/1", "avg_frame_rate": "1784250/59729", "duration": "11.945",
          "side_data_list": [ { "side_data_type": "Display Matrix", "rotation": -90 } ] },
        { "codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2 }
      ],
      "format": { "format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "11.960000" }
    }"#;

    #[test]
    fn parses_phone_video_with_rotation_and_vfr() {
        let (kind, p) = parse_probe(PHONE_VIDEO).unwrap();
        assert_eq!(kind, MediaKind::Video);
        assert_eq!(p.duration, 11_960_000);
        assert_eq!((p.width, p.height), (Some(1920), Some(1080)));
        assert_eq!(p.rotation, Some(90));
        assert_eq!(p.variable_frame_rate, Some(true));
        assert_eq!(
            p.fps,
            Some(Rational {
                num: 1784250,
                den: 59729
            })
        );
        assert_eq!(p.video_codec.as_deref(), Some("h264"));
        assert_eq!(p.audio_codec.as_deref(), Some("aac"));
        assert_eq!((p.sample_rate, p.channels), (Some(48000), Some(2)));
    }

    #[test]
    fn parses_cfr_2997() {
        let json = r#"{ "streams": [ { "codec_type": "video", "codec_name": "hevc", "width": 3840, "height": 2160,
            "r_frame_rate": "30000/1001", "avg_frame_rate": "30000/1001" } ],
            "format": { "format_name": "mov,mp4", "duration": "5.005" } }"#;
        let (kind, p) = parse_probe(json).unwrap();
        assert_eq!(kind, MediaKind::Video);
        assert_eq!(
            p.fps,
            Some(Rational {
                num: 30000,
                den: 1001
            })
        );
        assert_eq!(p.variable_frame_rate, Some(false));
        assert_eq!(p.rotation, None);
        assert_eq!(p.duration, 5_005_000);
    }

    #[test]
    fn music_with_cover_art_is_audio() {
        let json = r#"{ "streams": [
            { "codec_type": "audio", "codec_name": "mp3", "sample_rate": "44100", "channels": 2 },
            { "codec_type": "video", "codec_name": "mjpeg", "width": 500, "height": 500, "disposition": { "attached_pic": 1 } }
          ], "format": { "format_name": "mp3", "duration": "180.000000" } }"#;
        let (kind, p) = parse_probe(json).unwrap();
        assert_eq!(kind, MediaKind::Audio);
        assert_eq!(p.duration, 180_000_000);
        assert_eq!(p.width, None);
        assert_eq!(p.sample_rate, Some(44100));
    }

    #[test]
    fn png_is_image_with_zero_duration() {
        let json = r#"{ "streams": [ { "codec_type": "video", "codec_name": "png", "width": 800, "height": 600,
            "r_frame_rate": "25/1", "avg_frame_rate": "0/0" } ], "format": { "format_name": "png_pipe" } }"#;
        let (kind, p) = parse_probe(json).unwrap();
        assert_eq!(kind, MediaKind::Image);
        assert_eq!(p.duration, 0);
        assert_eq!((p.width, p.height), (Some(800), Some(600)));
        assert_eq!(p.fps, None);
    }

    #[test]
    fn rejects_files_without_media() {
        assert!(parse_probe(r#"{ "streams": [], "format": { "format_name": "tty" } }"#).is_err());
        assert!(parse_probe("isto não é json").is_err());
    }

    #[test]
    fn serializes_like_typescript() {
        let (_, p) = parse_probe(PHONE_VIDEO).unwrap();
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["duration"], 11_960_000);
        assert_eq!(v["variableFrameRate"], true);
        assert_eq!(v["fps"]["num"], 1784250);
        assert_eq!(v["sampleRate"], 48000);
        assert!(v.get("video_codec").is_none() && v.get("videoCodec").is_some());
    }

    /// Integração: só roda se houver ffmpeg/ffprobe no PATH.
    #[tokio::test]
    async fn probe_and_poster_with_real_ffmpeg() {
        if std::process::Command::new("ffprobe")
            .arg("-version")
            .output()
            .is_err()
        {
            eprintln!("ffprobe ausente, pulando");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("teste vídeo.mp4");
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=30",
                "-t",
                "2",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());

        let (kind, p) = probe(&input).await.unwrap();
        assert_eq!(kind, MediaKind::Video);
        assert_eq!((p.width, p.height), (Some(640), Some(360)));
        assert_eq!(p.fps, Some(Rational { num: 30, den: 1 }));
        assert_eq!(p.duration, 2_000_000);

        let out = dir.path().join("cache").join("poster.jpg");
        poster(&input, &out, 200_000, 160, None).await.unwrap();
        let bytes = std::fs::read(&out).unwrap();
        assert_eq!(&bytes[..2], &[0xFF, 0xD8], "JPEG válido");
        assert!(!out.with_extension("tmp.jpg").exists());

        assert!(probe(&dir.path().join("nao-existe.mp4")).await.is_err());

        // Foto JPEG: o pôster sai (instante 0) e em pé (640×360 girada → 160×284).
        let photo = dir.path().join("foto.jpg");
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360",
                "-frames:v",
                "1",
            ])
            .arg(&photo)
            .status()
            .unwrap();
        assert!(status.success());
        let out = dir.path().join("cache").join("foto.jpg");
        poster(&photo, &out, 0, 160, Some(90)).await.unwrap();
        let probe_out = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0",
            ])
            .arg(&out)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&probe_out.stdout).trim(), "160,284");
    }
}
