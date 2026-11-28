//! Orientação EXIF de fotos (JPEG e TIFF).
//!
//! Celulares gravam a foto "deitada" e anotam no EXIF quanto girar para mostrar.
//! O navegador já desenha girado (`imageOrientation: "from-image"`), mas o ffprobe
//! (até a versão 6) não informa esse giro. Sem ele, largura e altura na interface
//! ficam trocadas e as alças do preview não caem sobre a imagem.
//! Aqui só se lê o cabeçalho: nada de decodificar a imagem.

use std::io::Read;
use std::path::Path;

/// Quanto ler do começo do arquivo: o bloco EXIF fica logo no início (APP1 tem até 64 KB).
const HEAD_BYTES: u64 = 256 * 1024;

const TAG_ORIENTATION: u16 = 0x0112;

/// Giro no sentido horário (90, 180, 270) indicado pelo EXIF do arquivo, se houver.
pub fn read_rotation(path: &Path) -> Option<u16> {
    let mut head = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(HEAD_BYTES)
        .read_to_end(&mut head)
        .ok()?;
    rotation_from_bytes(&head)
}

/// Giro horário a partir do começo de um JPEG ou TIFF.
pub fn rotation_from_bytes(bytes: &[u8]) -> Option<u16> {
    let orientation = if bytes.starts_with(&[0xFF, 0xD8]) {
        jpeg_orientation(bytes)
    } else {
        tiff_orientation(bytes)
    }?;
    // 5 e 7 também espelham; o espelho o navegador aplica sozinho, aqui só importa o giro.
    match orientation {
        3 => Some(180),
        5 | 6 => Some(90),
        7 | 8 => Some(270),
        _ => None,
    }
}

fn jpeg_orientation(bytes: &[u8]) -> Option<u16> {
    let mut i = 2;
    while i + 4 <= bytes.len() {
        if bytes[i] != 0xFF {
            return None;
        }
        let marker = bytes[i + 1];
        // Bytes 0xFF de preenchimento entre segmentos.
        if marker == 0xFF {
            i += 1;
            continue;
        }
        // Início dos dados da imagem: daqui em diante não há mais EXIF.
        if marker == 0xDA || marker == 0xD9 {
            return None;
        }
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        if len < 2 {
            return None;
        }
        let body = bytes.get(i + 4..i + 2 + len)?;
        if marker == 0xE1 && body.starts_with(b"Exif\0\0") {
            return tiff_orientation(&body[6..]);
        }
        i += 2 + len;
    }
    None
}

fn tiff_orientation(tiff: &[u8]) -> Option<u16> {
    let little = match tiff.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |at: usize| -> Option<u16> {
        let b = tiff.get(at..at + 2)?;
        Some(if little {
            u16::from_le_bytes([b[0], b[1]])
        } else {
            u16::from_be_bytes([b[0], b[1]])
        })
    };
    let u32_at = |at: usize| -> Option<u32> {
        let b = tiff.get(at..at + 4)?;
        let a = [b[0], b[1], b[2], b[3]];
        Some(if little {
            u32::from_le_bytes(a)
        } else {
            u32::from_be_bytes(a)
        })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = u32_at(4)? as usize;
    let count = u16_at(ifd)? as usize;
    for n in 0..count {
        let entry = ifd + 2 + n * 12;
        if u16_at(entry)? == TAG_ORIENTATION {
            // Tipo SHORT: o valor fica nos 2 primeiros bytes do campo de valor.
            return u16_at(entry + 8);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TIFF mínimo com uma entrada de orientação no IFD0.
    fn tiff(little: bool, orientation: u16) -> Vec<u8> {
        let w16 = |v: u16| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let w32 = |v: u32| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let mut t = Vec::new();
        t.extend(if little { b"II" } else { b"MM" });
        t.extend(w16(42));
        t.extend(w32(8));
        t.extend(w16(2)); // duas entradas: uma qualquer e a orientação
        t.extend(w16(0x010F)); // Make
        t.extend(w16(2));
        t.extend(w32(4));
        t.extend(w32(0));
        t.extend(w16(TAG_ORIENTATION));
        t.extend(w16(3)); // SHORT
        t.extend(w32(1));
        t.extend(w16(orientation));
        t.extend(w16(0));
        t.extend(w32(0)); // próximo IFD
        t
    }

    fn jpeg_with(tiff: &[u8]) -> Vec<u8> {
        let mut j = vec![0xFF, 0xD8];
        // APP0 (JFIF) antes do EXIF, como muitos arquivos têm.
        j.extend([0xFF, 0xE0, 0x00, 0x07]);
        j.extend(b"JFIF\0");
        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend(tiff);
        j.extend([0xFF, 0xE1]);
        j.extend(((app1.len() + 2) as u16).to_be_bytes());
        j.extend(app1);
        j.extend([0xFF, 0xDA, 0x00, 0x02, 0x12, 0x34]);
        j
    }

    #[test]
    fn jpeg_orientations_both_byte_orders() {
        for little in [true, false] {
            assert_eq!(rotation_from_bytes(&jpeg_with(&tiff(little, 6))), Some(90));
            assert_eq!(rotation_from_bytes(&jpeg_with(&tiff(little, 3))), Some(180));
            assert_eq!(rotation_from_bytes(&jpeg_with(&tiff(little, 8))), Some(270));
            assert_eq!(rotation_from_bytes(&jpeg_with(&tiff(little, 1))), None);
        }
        // Espelhadas: só o giro conta.
        assert_eq!(rotation_from_bytes(&jpeg_with(&tiff(true, 5))), Some(90));
        assert_eq!(rotation_from_bytes(&jpeg_with(&tiff(true, 7))), Some(270));
        assert_eq!(rotation_from_bytes(&jpeg_with(&tiff(true, 2))), None);
    }

    #[test]
    fn tiff_file_itself() {
        assert_eq!(rotation_from_bytes(&tiff(true, 6)), Some(90));
    }

    #[test]
    fn missing_or_broken_data_is_none_without_panic() {
        let full = jpeg_with(&tiff(true, 6));
        for cut in 0..full.len() {
            let _ = rotation_from_bytes(&full[..cut]);
        }
        assert_eq!(rotation_from_bytes(b"\x89PNG\r\n\x1a\n"), None);
        assert_eq!(rotation_from_bytes(&[0xFF, 0xD8, 0xFF, 0xDA, 0, 2]), None);
        assert_eq!(rotation_from_bytes(&[0xFF, 0xD8, 0xFF, 0xE1, 0, 0]), None);
        assert_eq!(rotation_from_bytes(&[]), None);
    }

    #[test]
    fn reads_from_file() {
        let dir = std::env::temp_dir().join(format!("exif-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("foto.jpg");
        std::fs::write(&file, jpeg_with(&tiff(false, 8))).unwrap();
        assert_eq!(read_rotation(&file), Some(270));
        assert_eq!(read_rotation(&dir.join("nao-existe.jpg")), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
