# Achica pet-head.onnx de ~10 MB a ~3 MB: uso `python3 comprimir_modelo.py entrada.onnx salida.onnx`.
# Pesos int8 por canal (solo almacenamiento): W = int8 * escala, se reconstruye en float al cargar.
import sys
import numpy as np, onnx
from onnx import numpy_helper as nh, helper as h, TensorProto as T
m = onnx.load(sys.argv[1]); g = m.graph
conv_w = {n.input[1] for n in g.node if n.op_type == 'Conv'}
new_init, nodes = [], []
saved = 0
for init in g.initializer:
    a = nh.to_array(init)
    if init.name in conv_w and a.dtype == np.float32 and a.size >= 256:
        axes = tuple(range(1, a.ndim))
        s = np.abs(a).max(axis=axes, keepdims=True) / 127.0
        s[s == 0] = 1e-8
        q = np.clip(np.round(a / s), -127, 127).astype(np.int8)
        new_init += [nh.from_array(q, init.name + '_q'), nh.from_array(s.astype(np.float32), init.name + '_s')]
        nodes += [h.make_node('Cast', [init.name + '_q'], [init.name + '_f'], to=T.FLOAT),
                  h.make_node('Mul', [init.name + '_f', init.name + '_s'], [init.name])]
        saved += a.nbytes - q.nbytes
    else:
        new_init.append(init)
del g.initializer[:]; g.initializer.extend(new_init)
old = list(g.node); del g.node[:]; g.node.extend(nodes + old)
onnx.checker.check_model(m)
onnx.save(m, sys.argv[2])
print('saved MB', saved / 1e6)
