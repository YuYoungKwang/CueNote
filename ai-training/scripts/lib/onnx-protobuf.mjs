export function createConstantDetectionOnnx({ inputName, outputName, detections }) {
  const detectionFloats = detections.flatMap((detection) => [
    detection.bounds.x,
    detection.bounds.y,
    detection.bounds.width,
    detection.bounds.height,
    detection.confidence,
    detection.classIndex
  ]);
  const tensor = tensorProto({
    name: outputName,
    dims: [detections.length, 6],
    dataType: 1,
    floatValues: detectionFloats
  });
  const constant = message([
    fieldString(2, outputName),
    fieldString(3, 'ConstantDetections'),
    fieldString(4, 'Constant'),
    fieldMessage(5, attributeTensor('value', tensor))
  ]);
  const graph = message([
    fieldMessage(1, constant),
    fieldString(2, 'CueNoteSmokeDetectionGraph'),
    fieldMessage(11, valueInfo(inputName, [1, 1, 160, 320])),
    fieldMessage(12, valueInfo(outputName, [detections.length, 6]))
  ]);
  const opset = message([fieldVarint(2, 13)]);
  return message([
    fieldVarint(1, 8),
    fieldString(2, 'cuenote-ai-training'),
    fieldString(3, 'phase9-smoke'),
    fieldMessage(7, graph),
    fieldMessage(8, opset)
  ]);
}

function attributeTensor(name, tensor) {
  return message([
    fieldString(1, name),
    fieldMessage(5, tensor),
    fieldVarint(20, 4)
  ]);
}

function tensorProto({ name, dims, dataType, floatValues }) {
  const raw = Buffer.alloc(floatValues.length * 4);
  floatValues.forEach((value, index) => raw.writeFloatLE(value, index * 4));
  return message([
    ...dims.map((dim) => fieldVarint(1, dim)),
    fieldVarint(2, dataType),
    fieldString(8, name),
    fieldBytes(9, raw)
  ]);
}

function valueInfo(name, dims) {
  return message([
    fieldString(1, name),
    fieldMessage(2, typeProto(dims))
  ]);
}

function typeProto(dims) {
  return message([fieldMessage(1, tensorType(dims))]);
}

function tensorType(dims) {
  return message([
    fieldVarint(1, 1),
    fieldMessage(2, tensorShape(dims))
  ]);
}

function tensorShape(dims) {
  return message(dims.map((dim) => fieldMessage(1, message([fieldVarint(1, dim)]))));
}

function message(fields) {
  return Buffer.concat(fields.filter(Boolean));
}

function fieldString(number, value) {
  return fieldBytes(number, Buffer.from(value, 'utf8'));
}

function fieldMessage(number, value) {
  return fieldBytes(number, value);
}

function fieldBytes(number, value) {
  return Buffer.concat([tag(number, 2), varint(value.length), value]);
}

function fieldVarint(number, value) {
  return Buffer.concat([tag(number, 0), varint(value)]);
}

function tag(number, wireType) {
  return varint((number << 3) | wireType);
}

function varint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}
