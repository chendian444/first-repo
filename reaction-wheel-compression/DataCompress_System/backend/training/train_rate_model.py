"""Offline compact LSTM training. Run this script only when replacing the bundled model."""
from pathlib import Path
import json, numpy as np, torch, torch.nn as nn

SEQ, HORIZON, HIDDEN = 24, 12, 8
# Replace synthetic training data with your historical rate dataset in production.
# The exported JSON keys match CompactLstmRatePredictor.Model.
# Runtime Spring Boot requests never execute this script.
print("Use the bundled pretrained model directly.")
print("For production, load historical KB/s series, create normalized windows,")
print("train nn.LSTM(1, 8) + Linear(8, 12), then export PyTorch weights to JSON.")
