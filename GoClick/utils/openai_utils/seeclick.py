import torch, time, os
from transformers import AutoModelForCausalLM, AutoTokenizer
from goclick_candidate_generator import resolve_device

class SeeClick:
    def __init__(self, device=None, model_name: str = "cckevinn/SeeClick"):
        self.model_name = model_name
        self.device = resolve_device(device)
        dtype = torch.float32 if self.device in ("mps", "cpu") else torch.bfloat16
        
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=dtype,
            device_map=self.device if self.device != "mps" else None,
            trust_remote_code=True
        )
        if self.device == "mps":
            self.model = self.model.to("mps")
        self.model.eval()

        self.tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen-VL-Chat", trust_remote_code=True)
        
    def test_speed(self, prompt: str, image: str = None, max_new_tokens: int = 1024):
        if "<image>" in prompt:
            prompt = prompt.replace("<image>", "").strip()

        if '(with point)' not in prompt or '(with bbox)' not in prompt:
            prompt = prompt + ' (with point)'
        # Similar to llava, is visual paths has len 0
        # Then nothing will be executed
        query = []
        query.append({"image": image})
        query.append({"text": prompt})
        questions = self.tokenizer.from_list_format(query)

        start = time.time()
        with torch.inference_mode():
            text_output, history = self.model.chat(self.tokenizer, 
                                                    query=questions, 
                                                    history=None,
                                                    do_sample=False,
                                                    temperature=0,
                                                    use_cache=False,
                                                    max_new_tokens=max_new_tokens)
        duration = time.time() - start

        output_ids = self.tokenizer.encode(text_output)

        return duration, output_ids
    
