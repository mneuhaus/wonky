from build123d import Box, fillet

box = Box(20, 20, 10)
result = fillet(box.edges(), radius=1)
