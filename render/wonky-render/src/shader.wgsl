struct Camera { matrix: mat4x4<f32> }
@group(0) @binding(0) var<uniform> camera: Camera;
struct Output { @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32> }
@vertex fn vertex(@location(0) position: vec3<f32>, @location(1) normal: vec3<f32>) -> Output {
    var out: Output;
    out.position = camera.matrix * vec4<f32>(position, 1.0);
    out.normal = normal;
    return out;
}
@fragment fn surface(in: Output) -> @location(0) vec4<f32> {
    let n = normalize(in.normal);
    let light = 0.45 + 0.4 * abs(dot(n, normalize(vec3<f32>(0.4,-0.6,0.8))));
    return vec4<f32>(vec3<f32>(0.56,0.63,0.68)*light,1.0);
}
@fragment fn edge() -> @location(0) vec4<f32> { return vec4<f32>(0.08,0.11,0.14,1.0); }
