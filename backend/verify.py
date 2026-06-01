"""Quick verification script for all project components."""
import sys
import os
os.environ["PYTHONIOENCODING"] = "utf-8"
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")

print("=" * 60)
print("SMART PARKING AI - Component Verification")
print("=" * 60)

# 1. Test model architectures
print("\n[1] Testing model architectures...")
import torch
from src.models.cnn_scratch import ParkingCNN
from src.models.cnn_transfer import ParkingResNet, ParkingMobileNetV4

dummy = torch.randn(2, 3, 224, 224)

cnn = ParkingCNN()
p = cnn.count_parameters()
out = cnn(dummy)
print(f"    CNN Scratch:    {p['total']:,} params, output={out.shape}")

resnet = ParkingResNet(pretrained=False)
p = resnet.count_parameters()
out = resnet(dummy)
print(f"    ResNet50:       {p['total']:,} params ({p['trainable']:,} trainable), output={out.shape}")

mobilev4 = ParkingMobileNetV4(pretrained=False)
p = mobilev4.count_parameters()
out = mobilev4(dummy)
print(f"    MobileNetV4:    {p['total']:,} params ({p['trainable']:,} trainable), output={out.shape}")
print("    [OK] All models work!")

# 2. Test model factory
print("\n[2] Testing model factory...")
from src.models.model_factory import create_model, list_available_models
models = list_available_models()
print(f"    Available models: {models}")
for name in models:
    m = create_model(name, pretrained=False)
    print(f"    Created: {name} [OK]")

# 3. Test sample dataset generation
print("\n[3] Generating sample dataset...")
import logging
logging.basicConfig(level=logging.WARNING)
from src.data_prep.downloader import generate_sample_dataset
generate_sample_dataset(num_per_class=50)
print("    [OK] Sample dataset generated (50 per class)!")

# 4. Test data preprocessing
print("\n[4] Testing data preprocessing...")
from src.data_prep.preprocessor import prepare_dataset
data = prepare_dataset(batch_size=8, num_workers=0)
print(f"    Train: {data['train_size']}, Val: {data['val_size']}, Test: {data['test_size']}")
print(f"    Class distribution: {data['class_distribution']}")
print("    [OK] Data pipeline works!")

# 5. Quick training test (2 epochs)
print("\n[5] Quick training test (2 epochs on sample data)...")
tiny_model = ParkingCNN()
from src.train.trainer import Trainer
trainer = Trainer(tiny_model, model_name="cnn_scratch", epochs=2)
results = trainer.train(data["train_loader"], data["val_loader"])
print(f"    Best val_acc: {results['best_val_acc']:.2f}%")
print("    [OK] Training pipeline works!")

# 6. Test evaluation
print("\n[6] Testing evaluation...")
from src.eval.evaluator import evaluate_model
eval_results = evaluate_model(tiny_model, data["test_loader"], trainer.device)
print(f"    Accuracy: {eval_results['accuracy']}%, F1: {eval_results['f1_score']}%")
print("    [OK] Evaluation works!")

print("\n" + "=" * 60)
print("ALL COMPONENTS VERIFIED SUCCESSFULLY!")
print("=" * 60)
