"""Read PNG/JPEG dimensions from content, including mislabeled file extensions."""
import struct

def image_dimensions(path):
    data = path.read_bytes()
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return struct.unpack('>II', data[16:24])
    if data.startswith(b'\xff\xd8'):
        pos = 2
        while pos < len(data):
            if data[pos] != 255:
                pos += 1
                continue
            while data[pos] == 255: pos += 1
            marker = data[pos]; pos += 1
            if marker in (0xd8, 0xd9): continue
            length = struct.unpack('>H', data[pos:pos+2])[0]
            if marker in (0xc0, 0xc1, 0xc2, 0xc3):
                height, width = struct.unpack('>HH', data[pos+3:pos+7])
                return width, height
            pos += length
    raise ValueError(f'Unsupported image: {path}')
