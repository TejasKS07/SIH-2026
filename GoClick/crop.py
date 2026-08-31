import os
from PIL import Image


def crop_panels(screenshot_path: str = None) -> None:
    base_dir = os.path.dirname(__file__)
    if screenshot_path is None:
        screenshot_path = os.path.join(base_dir, "ui_screenshot.png")

    if not os.path.exists(screenshot_path):
        print(f"Source screenshot not found: {screenshot_path}")
        return

    composite = Image.open(screenshot_path).convert("RGB")
    w, h = composite.size
    third = w // 3

    panels = {
        os.path.join(base_dir, "test_payment.png"): (0, 0, third, h),
        os.path.join(base_dir, "test_passport.png"): (third, 0, 2 * third, h),
        os.path.join(base_dir, "test_medical.png"): (2 * third, 0, w, h),
    }

    for filename, box in panels.items():
        composite.crop(box).save(filename)
        print(f"Saved {os.path.basename(filename)}")


if __name__ == "__main__":
    crop_panels()