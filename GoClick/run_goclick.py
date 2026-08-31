import os
import re
from typing import Optional, Tuple
from PIL import Image, ImageDraw
import torch
from transformers import AutoModelForCausalLM, AutoProcessor

from goclick_candidate_generator import resolve_device

MODEL_NAME = "HongxinLi/GoClick-Base"  # or "HongxinLi/GoClick-Large"


def get_model_and_processor(model_name: str = MODEL_NAME, device: Optional[str] = None):
    """Lazily loads the model and processor on the selected device."""
    target_device = resolve_device(device)
    print(f"Loading {model_name} on device: {target_device}")

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        torch_dtype=torch.float32,
    ).to(target_device)
    model.eval()

    processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
    return model, processor, target_device


def build_prompt(goal_info: str, mode: str) -> str:
    if mode == "functionality":
        return (
            f"Locate the element according to its detailed functionality "
            f"description. {goal_info} (Output the center coordinates of the target)"
        )
    elif mode == "intent":
        return (
            f"I want to {goal_info}. Please locate the target element I "
            f"should interact with. (Output the center coordinates of the target)"
        )
    elif mode == "description":
        return f"Where is the {goal_info} element? (Output the center coordinates of the target)"
    else:
        raise ValueError(f"mode must be 'functionality', 'intent', or 'description', got '{mode}'")


def postprocess(text: str) -> Tuple[int, int]:
    point_pattern = r"<loc_(\d+)>,<loc_(\d+)>"
    match = re.findall(point_pattern, text)
    if match:
        x, y = [int(v) for v in match[0]]
        return x, y
    return 0, 0


def locate_element(
    image: Image.Image,
    goal_info: str,
    mode: str = "intent",
    max_new_tokens: int = 128,
    model=None,
    processor=None,
    device: Optional[str] = None,
) -> Tuple[int, int]:
    if model is None or processor is None:
        model, processor, device = get_model_and_processor(MODEL_NAME, device)
    elif device is None:
        device = resolve_device()

    if image.mode != "RGB":
        image = image.convert("RGB")

    prompt = build_prompt(goal_info, mode)

    inputs = processor(
        images=image,
        text=prompt,
        return_tensors="pt",
        do_resize=True,
    ).to(device, dtype=torch.float32)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            do_sample=False,
            max_new_tokens=max_new_tokens,
            use_cache=True,
        )

    raw_text = processor.tokenizer.batch_decode(outputs, skip_special_tokens=False)[0]
    x_norm, y_norm = postprocess(raw_text)

    w, h = image.size
    x_px = int(x_norm / 1000 * w)
    y_px = int(y_norm / 1000 * h)
    return x_px, y_px


if __name__ == "__main__":
    screenshot_path = os.path.join(os.path.dirname(__file__), "ui_screenshot.png")
    if not os.path.exists(screenshot_path):
        print(f"Screenshot not found at {screenshot_path}")
    else:
        image = Image.open(screenshot_path).convert("RGB")

        x, y = locate_element(
            image,
            goal_info="pay button or card number field",
            mode="description",
        )

        print(f"Target coordinates: ({x}, {y})")

        debug_img = image.copy()
        draw = ImageDraw.Draw(debug_img)
        r = 15
        draw.ellipse((x - r, y - r, x + r, y + r), outline="red", width=4)
        output_path = os.path.join(os.path.dirname(__file__), "debug_output.png")
        debug_img.save(output_path)
        print(f"Saved {output_path} — open it to see the predicted click point.")