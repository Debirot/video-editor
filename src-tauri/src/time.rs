//! Tempo no lado Rust: µs inteiros e FPS racional, como em src/lib/time.ts.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rational {
    pub num: u32,
    pub den: u32,
}

impl Rational {
    /// Lê "30000/1001" ou "30". Recusa zero ("0/0", "0/1").
    pub fn parse(s: &str) -> Option<Rational> {
        let (num, den) = match s.split_once('/') {
            Some((n, d)) => (n.trim().parse().ok()?, d.trim().parse().ok()?),
            None => (s.trim().parse().ok()?, 1),
        };
        (num > 0 && den > 0).then_some(Rational { num, den })
    }

    pub fn as_f64(self) -> f64 {
        f64::from(self.num) / f64::from(self.den)
    }
}

/// "12.345678" (segundos, como o ffprobe escreve) → µs inteiros. "N/A" e negativos → None.
pub fn seconds_str_to_us(s: &str) -> Option<i64> {
    let secs: f64 = s.trim().parse().ok()?;
    (secs.is_finite() && secs >= 0.0).then(|| (secs * 1_000_000.0).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rational() {
        assert_eq!(
            Rational::parse("30000/1001"),
            Some(Rational {
                num: 30000,
                den: 1001
            })
        );
        assert_eq!(Rational::parse("25"), Some(Rational { num: 25, den: 1 }));
        assert_eq!(Rational::parse("0/0"), None);
        assert_eq!(Rational::parse("30/0"), None);
        assert_eq!(Rational::parse("abc"), None);
        assert!(
            (Rational {
                num: 30000,
                den: 1001
            }
            .as_f64()
                - 29.97)
                .abs()
                < 0.001
        );
    }

    #[test]
    fn seconds() {
        assert_eq!(seconds_str_to_us("12.000000"), Some(12_000_000));
        assert_eq!(seconds_str_to_us("0.033367"), Some(33_367));
        assert_eq!(seconds_str_to_us("5.005"), Some(5_005_000));
        assert_eq!(seconds_str_to_us("N/A"), None);
        assert_eq!(seconds_str_to_us("-1"), None);
    }
}
