# PowerShell SFT fine-tuning script for Windows
param(
    [string]$ModelName = "microsoft/Florence-2-large",
    [string]$DataPath = "./data/train.jsonl",
    [string]$OutputDir = "./checkpoints/goclick_finetune",
    [int]$NumGpus = 1
)

Write-Host "Starting GoClick SFT Training on Windows..." -ForegroundColor Cyan

if ($NumGpus -gt 1) {
    torchrun --nproc_per_node $NumGpus --nnodes 1 --master_port 16252 florence2/finetune.py `
        --model_name_or_path $ModelName `
        --florence_path $ModelName `
        --data_path $DataPath `
        --output_dir $OutputDir `
        --num_train_epochs 1 `
        --per_device_train_batch_size 4 `
        --per_device_eval_batch_size 2 `
        --gradient_accumulation_steps 1 `
        --eval_strategy no `
        --save_strategy epoch `
        --save_total_limit 3 `
        --learning_rate 1e-4 `
        --weight_decay 0.1 `
        --warmup_ratio 0.01 `
        --lr_scheduler_type cosine `
        --logging_steps 2 `
        --report_to none `
        --model_max_length 1024 `
        --lazy_preprocess $true
} else {
    python florence2/finetune.py `
        --model_name_or_path $ModelName `
        --florence_path $ModelName `
        --data_path $DataPath `
        --output_dir $OutputDir `
        --num_train_epochs 1 `
        --per_device_train_batch_size 4 `
        --per_device_eval_batch_size 2 `
        --gradient_accumulation_steps 1 `
        --eval_strategy no `
        --save_strategy epoch `
        --save_total_limit 3 `
        --learning_rate 1e-4 `
        --weight_decay 0.1 `
        --warmup_ratio 0.01 `
        --lr_scheduler_type cosine `
        --logging_steps 2 `
        --report_to none `
        --model_max_length 1024 `
        --lazy_preprocess $true
}
