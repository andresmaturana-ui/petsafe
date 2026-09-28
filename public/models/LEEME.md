`pet-head.onnx`: detector de cabezas de perros y gatos (YOLO11n, entrada
320x320, una clase), entrenado con `training/entrenar_detector.ipynb` sobre
Oxford-IIIT Pet (mAP50 0.99 en validación) y achicado a ~3 MB con
`training/comprimir_modelo.py` (pesos int8 por canal; mismas detecciones). Si se borra, la app vuelve a usar
el detector general (YOLOS-tiny).
