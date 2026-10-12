// Windows tray icons have no title text and no per-app taskbar badge API, so
// the unread count is baked straight into the icon's pixels instead (see
// tray.rs's `#[cfg(target_os = "windows")]` block in `refresh`). Pure pixel
// math — no image crate needed for a filled circle and a few digits.
//
// Only called from Windows builds, but kept unconditional (not
// `#[cfg(target_os = "windows")]`) so its tests run on every platform.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use tauri::image::Image;

const BADGE_COLOR: [u8; 4] = [0xe0, 0x44, 0x3e, 0xff];
const TEXT_COLOR: [u8; 4] = [0xff, 0xff, 0xff, 0xff];
const BADGE_DIAMETER_RATIO: f64 = 0.55;

/// 3x5 bitmap font (columns packed into the low 3 bits of each row, top to
/// bottom) covering the only characters a badge ever needs.
fn glyph(c: char) -> [u8; 5] {
    match c {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b001, 0b001, 0b001],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        _ => [0; 5],
    }
}

fn badge_text(count: i64) -> String {
    if count > 9 { "9+".to_string() } else { count.to_string() }
}

fn badge_circle(width: u32, height: u32) -> (f64, f64, f64) {
    let radius = (width.min(height) as f64) * BADGE_DIAMETER_RATIO / 2.0;
    let cx = width as f64 - radius;
    let cy = radius;
    (cx, cy, radius)
}

fn set_pixel(pixels: &mut [u8], width: u32, x: u32, y: u32, rgba: [u8; 4]) {
    let idx = ((y * width + x) * 4) as usize;
    if idx + 4 <= pixels.len() {
        pixels[idx..idx + 4].copy_from_slice(&rgba);
    }
}

fn draw_circle(pixels: &mut [u8], width: u32, height: u32, cx: f64, cy: f64, radius: f64) {
    for y in 0..height {
        for x in 0..width {
            let dx = x as f64 + 0.5 - cx;
            let dy = y as f64 + 0.5 - cy;
            if dx * dx + dy * dy <= radius * radius {
                set_pixel(pixels, width, x, y, BADGE_COLOR);
            }
        }
    }
}

fn draw_text(pixels: &mut [u8], width: u32, height: u32, cx: f64, cy: f64, radius: f64, text: &str) {
    const GLYPH_W: usize = 3;
    const GLYPH_H: usize = 5;
    const GAP: usize = 1;

    let n = text.chars().count();
    let scale = (((radius * 2.0 * 0.7) / GLYPH_H as f64).floor() as usize).max(1);
    let total_w = (n * GLYPH_W + n.saturating_sub(1) * GAP) * scale;
    let total_h = GLYPH_H * scale;
    let start_x = cx - total_w as f64 / 2.0;
    let start_y = cy - total_h as f64 / 2.0;

    for (i, c) in text.chars().enumerate() {
        let bitmap = glyph(c);
        let glyph_x0 = start_x + (i * (GLYPH_W + GAP) * scale) as f64;
        for (row, bits) in bitmap.iter().enumerate() {
            for col in 0..GLYPH_W {
                if (bits >> (GLYPH_W - 1 - col)) & 1 == 0 {
                    continue;
                }
                for sy in 0..scale {
                    for sx in 0..scale {
                        let px = (glyph_x0 + (col * scale + sx) as f64).round();
                        let py = (start_y + (row * scale + sy) as f64).round();
                        if px >= 0.0 && py >= 0.0 && (px as u32) < width && (py as u32) < height {
                            set_pixel(pixels, width, px as u32, py as u32, TEXT_COLOR);
                        }
                    }
                }
            }
        }
    }
}

/// Draws an unread-count badge onto a copy of `base`'s RGBA buffer.
/// `count <= 0` returns an unmodified copy; anything above 9 renders as "9+".
pub fn with_count(base: &Image<'_>, count: i64) -> Image<'static> {
    let width = base.width();
    let height = base.height();
    let mut pixels = base.rgba().to_vec();

    if count > 0 {
        let (cx, cy, radius) = badge_circle(width, height);
        draw_circle(&mut pixels, width, height, cx, cy, radius);
        draw_text(&mut pixels, width, height, cx, cy, radius, &badge_text(count));
    }

    Image::new_owned(pixels, width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_image(width: u32, height: u32, rgba: [u8; 4]) -> Image<'static> {
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            pixels.extend_from_slice(&rgba);
        }
        Image::new_owned(pixels, width, height)
    }

    fn white_pixel_count(img: &Image<'static>) -> usize {
        img.rgba().chunks_exact(4).filter(|p| p[0] > 200 && p[1] > 200 && p[2] > 200).count()
    }

    #[test]
    fn zero_count_leaves_buffer_unchanged() {
        let base = solid_image(32, 32, [10, 20, 30, 255]);
        let result = with_count(&base, 0);
        assert_eq!(result.rgba(), base.rgba());
        assert_eq!(result.width(), base.width());
        assert_eq!(result.height(), base.height());
    }

    #[test]
    fn negative_count_leaves_buffer_unchanged() {
        let base = solid_image(32, 32, [10, 20, 30, 255]);
        let result = with_count(&base, -1);
        assert_eq!(result.rgba(), base.rgba());
    }

    #[test]
    fn count_changes_only_pixels_inside_badge_circle() {
        let width = 32;
        let height = 32;
        let base = solid_image(width, height, [10, 20, 30, 255]);
        let result = with_count(&base, 5);
        let (cx, cy, radius) = badge_circle(width, height);

        let mut changed = 0;
        for y in 0..height {
            for x in 0..width {
                let idx = ((y * width + x) * 4) as usize;
                if base.rgba()[idx..idx + 4] != result.rgba()[idx..idx + 4] {
                    changed += 1;
                    let dx = x as f64 + 0.5 - cx;
                    let dy = y as f64 + 0.5 - cy;
                    assert!(
                        dx * dx + dy * dy <= (radius + 1.0).powi(2),
                        "changed pixel outside badge circle at ({x},{y})"
                    );
                }
            }
        }
        assert!(changed > 0);
    }

    #[test]
    fn double_digit_renders_two_glyphs() {
        let base = solid_image(32, 32, [10, 20, 30, 255]);
        let single = with_count(&base, 1);
        let double = with_count(&base, 15);
        assert_eq!(badge_text(15), "9+");
        assert!(white_pixel_count(&double) > white_pixel_count(&single));
    }

    #[test]
    fn badge_text_caps_at_nine_plus() {
        assert_eq!(badge_text(9), "9");
        assert_eq!(badge_text(10), "9+");
        assert_eq!(badge_text(999), "9+");
    }
}
