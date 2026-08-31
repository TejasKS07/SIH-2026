#!/usr/bin/env bash
# SFT fine-tuning script for macOS and Linux

MODEL_NAME=${1:-"microsoft/Florence-2-large"}
DATA_PATH=${2:-"./data/train.jsonl"}
OUTPUT_DIR=${3:-"./checkpoints/goclick_finetune"}
NUM_GPUS=${4:-1}

echo "Starting GoClick SFT Training on $(uname -s)..."

if [ "$NUM_GPUS" -gt 1 ]; then
    torchrun --nproc_per_node "$NUM_GPUS" --nnodes 1 --master_port 16252 florence2/finetune.py \
        --model_name_or_path "$MODEL_NAME" \
        --florence_path "$MODEL_NAME" \
        --data_path "$DATA_PATH" \
        --output_dir "$OUTPUT_DIR" \
        --num_train_epochs 1 \
        --per_device_train_batch_size 4 \
        --per_device_eval_batch_size 2 \
        --gradient_accumulation_steps 1 \
        --eval_strategy no \
        --save_strategy epoch \
        --save_total_limit 3 \
        --learning_rate 1e-4 \
        --weight_decay 0.1 \
        --warmup_ratio 0.01 \
        --lr_scheduler_type cosine \
        --logging_steps 2 \
        --report_to none \
        --model_max_length 1024 \
        --lazy_preprocess True
else
    python florence2/finetune.py \
        --model_name_or_path "$MODEL_NAME" \
        --florence_path "$MODEL_NAME" \
        --data_path "$DATA_PATH" \
        --output_dir "$OUTPUT_DIR" \
        --num_train_epochs 1 \
        --per_device_train_batch_size 4 \
        --per_device_eval_batch_size 2 \
        --gradient_accumulation_steps 1 \
        --eval_strategy no \
        --save_strategy epoch \
        --save_total_limit 3 \
        --learning_rate 1e-4 \
        --weight_decay 0.1 \
        --warmup_ratio 0.01 \
        --lr_scheduler_type cosine \
        --logging_steps 2 \
        --report_to none \
        --model_max_length 1024 \
        --lazy_preprocess True
fi