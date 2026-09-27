// Transport floor for the out-of-process baseline (not a kernel component).
// Speaks the framing of service.bend without any Bend runtime: read one
// 16-byte header (payload length = little-endian word 3), read the payload,
// write header and payload back unchanged, repeat. EOF between frames exits 0.
// Like the Bend service it reads a whole frame before answering, so blocking
// clients cannot deadlock on large frames. Built by
// scripts/native-bridge/build-baseline.mjs.
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

static int transfer(int fd, uint8_t *bytes, size_t length, int writing) {
  size_t at = 0;
  while (at < length) {
    ssize_t n = writing ? write(fd, bytes + at, length - at) : read(fd, bytes + at, length - at);
    if (n <= 0) return at == 0 && !writing ? 1 : -1;
    at += (size_t)n;
  }
  return 0;
}

int main(void) {
  uint8_t header[16];
  uint8_t *payload = NULL;
  size_t capacity = 0;
  for (;;) {
    int r = transfer(0, header, sizeof header, 0);
    if (r == 1) return 0;
    if (r < 0) return 66;
    size_t length = (size_t)header[12] | (size_t)header[13] << 8 | (size_t)header[14] << 16 | (size_t)header[15] << 24;
    if (length > capacity) {
      payload = realloc(payload, length);
      if (!payload) return 71;
      capacity = length;
    }
    if (transfer(0, payload, length, 0) != 0) return 66;
    if (transfer(1, header, sizeof header, 1) != 0 || transfer(1, payload, length, 1) != 0) return 74;
  }
}
