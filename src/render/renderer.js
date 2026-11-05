// WebGPU renderer: device setup, buffers, pipelines and the per-frame draw.
// Every object gets a 256-byte slot in one uniform buffer and is drawn with a
// dynamic offset, so a frame needs only one writeBuffer per uniform buffer.

import { meshShader, colorShader } from './shaders.js';
import { FLOATS as IMM_FLOATS } from './immediate.js';

const SAMPLES = 4;
const DEPTH_FORMAT = 'depth24plus';
const CAMERA_FLOATS = 24;   // viewProj(16) + eye(4) + light(4)
const OBJECT_FLOATS = 40;   // model(16) + normalMat(16) + color(4) + params(4)
const MAX_VIEWS = 2;

export class Renderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser (try a current Chrome, Edge, Safari 26+ or Firefox 141+).');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No suitable GPU adapter was found.');
    const features = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
    const device = await adapter.requestDevice({ requiredFeatures: features });
    return new Renderer(canvas, adapter, device);
  }

  constructor(canvas, adapter, device) {
    this.canvas = canvas;
    this.device = device;
    const info = adapter.info || {};
    this.adapterName = [info.vendor, info.architecture, info.description || info.device].filter(Boolean).join(' · ') || 'unknown GPU';
    this.context = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.align = device.limits.minUniformBufferOffsetAlignment;
    this.meshes = new Map();
    this.lost = false;
    device.lost.then((e) => { this.lost = true; console.error('WebGPU device lost:', e.message); });

    this._createLayouts();
    this._createPipelines();
    this._createUniforms(256);
    this._createPlaceholderTexture();
    this.immBuffer = null;
    this.immCapacity = 0;
    this.gpuMs = null;
    if (device.features.has('timestamp-query')) this._createTimestamps();
  }

  /* ------------------------------------------------------------ setup */

  _createLayouts() {
    const d = this.device, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.cameraBGL = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: CAMERA_FLOATS * 4 } }],
    });
    this.objectBGL = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: OBJECT_FLOATS * 4 } }],
    });
    this.textureBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, sampler: { type: 'filtering' } },
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
      ],
    });
    this.meshLayout = d.createPipelineLayout({ bindGroupLayouts: [this.cameraBGL, this.objectBGL, this.textureBGL] });
    this.colorLayout = d.createPipelineLayout({ bindGroupLayouts: [this.cameraBGL] });
  }

  _createPipelines() {
    const d = this.device;
    const meshModule = d.createShaderModule({ label: 'mesh', code: meshShader });
    const colorModule = d.createShaderModule({ label: 'color', code: colorShader });
    const depthStencil = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' };
    const multisample = { count: SAMPLES };
    const meshBuffers = [{
      arrayStride: 32,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
      ],
    }];
    const colorBuffers = [{
      arrayStride: IMM_FLOATS * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x4' },
      ],
    }];
    const blend = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const meshPipe = (entry, label) => d.createRenderPipeline({
      label, layout: this.meshLayout,
      vertex: { module: meshModule, entryPoint: 'vs', buffers: meshBuffers },
      fragment: { module: meshModule, entryPoint: entry, targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil, multisample,
    });
    const colorPipe = (topology, label) => d.createRenderPipeline({
      label, layout: this.colorLayout,
      vertex: { module: colorModule, entryPoint: 'vs', buffers: colorBuffers },
      fragment: { module: colorModule, entryPoint: 'fs', targets: [{ format: this.format, blend }] },
      primitive: { topology },
      depthStencil, multisample,
    });
    this.pipelines = {
      lit: meshPipe('fsLit', 'lit mesh'),
      painting: meshPipe('fsPainting', 'painting'),
      tris: colorPipe('triangle-list', 'immediate triangles'),
      lines: colorPipe('line-list', 'immediate lines'),
    };
  }

  _createUniforms(objectCapacity) {
    const d = this.device;
    this.cameraBuffer ??= d.createBuffer({ size: this.align * MAX_VIEWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cameraBG ??= d.createBindGroup({
      layout: this.cameraBGL,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer, size: CAMERA_FLOATS * 4 } }],
    });
    this.objectBuffer?.destroy();
    this.objectCapacity = objectCapacity;
    this.objectBuffer = d.createBuffer({ size: this.align * objectCapacity, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.objectData = new Float32Array((this.align * objectCapacity) / 4);
    this.objectBG = d.createBindGroup({
      layout: this.objectBGL,
      entries: [{ binding: 0, resource: { buffer: this.objectBuffer, size: OBJECT_FLOATS * 4 } }],
    });
  }

  _createPlaceholderTexture() {
    const tex = this.device.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: tex }, new Uint8Array([128, 128, 128, 255]), { bytesPerRow: 4 }, [1, 1]);
    this._setTexture(tex);
  }

  _setTexture(tex) {
    this.sampler ??= this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
    this.textureBG = this.device.createBindGroup({
      layout: this.textureBGL,
      entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: tex.createView() }],
    });
  }

  /** Load the painting into an sRGB texture (with a full mip chain to avoid shimmering). */
  async loadTexture(url) {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const mipLevelCount = Math.floor(Math.log2(Math.max(bmp.width, bmp.height))) + 1;
    const tex = this.device.createTexture({
      size: [bmp.width, bmp.height], format: 'rgba8unorm-srgb', mipLevelCount,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
    this._generateMips(tex, mipLevelCount);
    this._setTexture(tex);
    return { width: bmp.width, height: bmp.height };
  }

  _generateMips(tex, levels) {
    const d = this.device;
    const module = d.createShaderModule({
      code: /* wgsl */ `
        struct O { @builtin(position) p : vec4f, @location(0) uv : vec2f };
        @vertex fn vs(@builtin(vertex_index) i : u32) -> O {
          let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));       // full-screen triangle
          var o : O; o.p = vec4f(xy * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(xy.x, 1.0 - xy.y); return o;
        }
        @group(0) @binding(0) var s : sampler;
        @group(0) @binding(1) var t : texture_2d<f32>;
        @fragment fn fs(in : O) -> @location(0) vec4f { return textureSample(t, s, in.uv); }`,
    });
    const pipe = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: tex.format }] },
    });
    const sampler = d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const enc = d.createCommandEncoder();
    for (let level = 1; level < levels; level++) {
      const bg = d.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: tex.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) }],
      });
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: tex.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }
    d.queue.submit([enc.finish()]);
  }

  _createTimestamps() {
    const d = this.device;
    this.querySet = d.createQuerySet({ type: 'timestamp', count: 2 });
    this.queryResolve = d.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.queryRead = d.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.queryBusy = false;
  }

  /** Upload (or replace) a mesh. */
  uploadMesh(key, { vertices, indices }) {
    const d = this.device, old = this.meshes.get(key);
    if (old) { old.vb.destroy(); old.ib.destroy(); }
    const vb = d.createBuffer({ size: Math.max(16, vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const ib = d.createBuffer({ size: Math.max(16, indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vb, 0, vertices);
    d.queue.writeBuffer(ib, 0, indices);
    this.meshes.set(key, { vb, ib, indexCount: indices.length });
  }

  /** Resize the canvas back buffer and the MSAA / depth targets (device pixels). */
  resize(width, height) {
    const max = this.device.limits.maxTextureDimension2D;
    width = Math.max(1, Math.min(max, Math.floor(width)));
    height = Math.max(1, Math.min(max, Math.floor(height)));
    if (this.canvas.width === width && this.canvas.height === height && this.msaa) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.msaa?.destroy();
    this.depth?.destroy();
    this.msaa = this.device.createTexture({ size: [width, height], sampleCount: SAMPLES, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depth = this.device.createTexture({ size: [width, height], sampleCount: SAMPLES, format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  /* ------------------------------------------------------------ frame */

  /**
   * frame = {
   *   views:   [{ rect: [x, y, w, h] device px, viewProj, eye, inspection }],
   *   objects: [{ mesh, model, normalMat, color (linear rgb), lit, painting }],
   *   tris, lines, inspectLines: Batch,
   *   clearColor: [r, g, b] (sRGB)
   * }
   * returns { vertices, drawCalls }
   */
  render(frame) {
    const d = this.device;
    if (this.lost || !this.msaa) return { vertices: 0, drawCalls: 0 };

    // camera uniforms (one aligned slot per view)
    const camData = new Float32Array((this.align * MAX_VIEWS) / 4);
    frame.views.forEach((v, i) => {
      const o = (i * this.align) / 4;
      camData.set(v.viewProj, o);
      camData.set([v.eye[0], v.eye[1], v.eye[2], 1], o + 16);
      camData.set([0.45, 0.8, 0.55, 0], o + 20);
    });
    d.queue.writeBuffer(this.cameraBuffer, 0, camData);

    // object uniforms
    const objects = frame.objects.filter((o) => this.meshes.has(o.mesh));
    if (objects.length > this.objectCapacity) this._createUniforms(Math.ceil(objects.length * 1.5));
    const stride = this.align / 4, od = this.objectData;
    objects.forEach((o, i) => {
      const k = i * stride;
      od.set(o.model, k);
      od.set(o.normalMat, k + 16);
      od[k + 32] = o.color[0]; od[k + 33] = o.color[1]; od[k + 34] = o.color[2]; od[k + 35] = 1;
      od[k + 36] = o.lit ? 1 : 0;
    });
    if (objects.length) d.queue.writeBuffer(this.objectBuffer, 0, od, 0, objects.length * stride);

    // immediate geometry, packed into one vertex buffer
    const batches = [frame.tris, frame.lines, frame.inspectLines];
    const total = batches.reduce((s, b) => s + b.count, 0) * IMM_FLOATS * 4;
    if (total > this.immCapacity) {
      this.immBuffer?.destroy();
      this.immCapacity = Math.max(1 << 16, 2 ** Math.ceil(Math.log2(total)));
      this.immBuffer = d.createBuffer({ size: this.immCapacity, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    const offsets = [];
    let off = 0;
    for (const b of batches) {
      offsets.push(off);
      if (b.count) d.queue.writeBuffer(this.immBuffer, off, b.view());
      off += b.count * IMM_FLOATS * 4;
    }

    const enc = d.createCommandEncoder();
    const [r, g, b] = frame.clearColor.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const passDesc = {
      colorAttachments: [{
        view: this.msaa.createView(),
        resolveTarget: this.context.getCurrentTexture().createView(),
        clearValue: { r, g, b, a: 1 }, loadOp: 'clear', storeOp: 'discard',
      }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    };
    const timing = this.querySet && !this.queryBusy;
    if (timing) passDesc.timestampWrites = { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
    const pass = enc.beginRenderPass(passDesc);

    let vertices = 0, drawCalls = 0;
    frame.views.forEach((view, vi) => {
      const [x, y, w, h] = view.rect;
      pass.setViewport(x, y, w, h, 0, 1);
      pass.setScissorRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
      pass.setBindGroup(0, this.cameraBG, [vi * this.align]);

      // meshes
      pass.setBindGroup(2, this.textureBG);
      let current = null;
      objects.forEach((o, i) => {
        const pipe = o.painting ? this.pipelines.painting : this.pipelines.lit;
        if (pipe !== current) { pass.setPipeline(pipe); pass.setBindGroup(2, this.textureBG); current = pipe; }
        const m = this.meshes.get(o.mesh);
        pass.setBindGroup(1, this.objectBG, [i * this.align]);
        pass.setVertexBuffer(0, m.vb);
        pass.setIndexBuffer(m.ib, 'uint32');
        pass.drawIndexed(m.indexCount);
        vertices += m.indexCount; drawCalls++;
      });

      // immediate geometry
      const drawBatch = (batch, offset, pipe) => {
        if (!batch.count) return;
        pass.setPipeline(pipe);
        pass.setVertexBuffer(0, this.immBuffer, offset, batch.count * IMM_FLOATS * 4);
        pass.draw(batch.count);
        vertices += batch.count; drawCalls++;
      };
      drawBatch(frame.tris, offsets[0], this.pipelines.tris);
      drawBatch(frame.lines, offsets[1], this.pipelines.lines);
      if (view.inspection) drawBatch(frame.inspectLines, offsets[2], this.pipelines.lines);
    });
    pass.end();

    if (timing) {
      enc.resolveQuerySet(this.querySet, 0, 2, this.queryResolve, 0);
      enc.copyBufferToBuffer(this.queryResolve, 0, this.queryRead, 0, 16);
    }
    d.queue.submit([enc.finish()]);
    if (timing) {
      this.queryBusy = true;
      this.queryRead.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigUint64Array(this.queryRead.getMappedRange());
        const ns = Number(t[1] - t[0]);
        if (ns > 0 && ns < 1e9) this.gpuMs = ns / 1e6;
        this.queryRead.unmap();
        this.queryBusy = false;
      }).catch(() => { this.queryBusy = false; });
    }
    return { vertices, drawCalls };
  }
}
