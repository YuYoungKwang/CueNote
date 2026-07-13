import type { OmrExecutionProvider, OmrModelManifest } from '@cuenote/score-domain';
import type { OmrTensorInput } from './tensorBuilder';

export interface LoadedOmrModel {
  modelId: string;
  version: string;
  provider: OmrExecutionProvider;
  inputNames: string[];
  outputNames: string[];
  dispose(): Promise<void>;
}

export interface RawOmrOutput {
  provider: OmrExecutionProvider;
  outputs: Record<string, { dims: readonly number[]; data: Float32Array | Int32Array | BigInt64Array | Uint8Array }>;
  inferenceTimeMs: number;
}

export interface OmrRuntimeAdapter {
  loadModel(manifest: OmrModelManifest, bytes: ArrayBuffer): Promise<{ model: LoadedOmrModel; fallbackReason?: string }>;
  run(model: LoadedOmrModel, input: OmrTensorInput): Promise<RawOmrOutput>;
}

export function createOnnxRuntimeAdapter(): OmrRuntimeAdapter {
  let ortPromise: Promise<typeof import('onnxruntime-web')> | null = null;
  const sessions = new WeakMap<LoadedOmrModel, import('onnxruntime-web').InferenceSession>();

  const loadOrt = async () => {
    ortPromise ??= import('onnxruntime-web').then((ort) => {
      ort.env.wasm.wasmPaths = '/ort/';
      ort.env.wasm.numThreads = 1;
      return ort;
    });
    return ortPromise;
  };

  const createSession = async (provider: OmrExecutionProvider, bytes: ArrayBuffer) => {
    const ort = await loadOrt();
    const executionProvider = provider === 'WEBGPU' ? 'webgpu' : 'wasm';
    return ort.InferenceSession.create(bytes.slice(0), { executionProviders: [executionProvider] });
  };

  return {
    async loadModel(manifest, bytes) {
      let fallbackReason: string | undefined;
      const requestedProviders = manifest.executionProviders.length ? manifest.executionProviders : ['WASM'];
      const providers: OmrExecutionProvider[] = requestedProviders.includes('WEBGPU') ? ['WEBGPU', 'WASM'] : ['WASM'];

      for (const provider of providers) {
        try {
          if (provider === 'WEBGPU' && !('gpu' in navigator)) {
            throw new Error('WEBGPU_UNAVAILABLE');
          }
          if (provider === 'WEBGPU' && !self.crossOriginIsolated) {
            throw new Error('WEBGPU_UNAVAILABLE_CROSS_ORIGIN_ISOLATION');
          }
          const session = await createSession(provider, bytes);
          const model: LoadedOmrModel = {
            modelId: manifest.modelId,
            version: manifest.version,
            provider,
            inputNames: session.inputNames,
            outputNames: session.outputNames,
            dispose: async () => {
              await session.release();
            }
          };
          sessions.set(model, session);
          return { model, fallbackReason };
        } catch (error) {
          const reason = error instanceof Error ? error.message : `${provider} session creation failed`;
          if (provider === 'WEBGPU') {
            fallbackReason = reason;
            continue;
          }
          throw new Error(provider === 'WASM' ? `WASM_INITIALIZATION_FAILED: ${reason}` : reason);
        }
      }

      throw new Error('MODEL_SESSION_FAILED');
    },
    async run(model, input) {
      const session = sessions.get(model);
      if (!session) {
        throw new Error('MODEL_SESSION_FAILED');
      }
      const ort = await loadOrt();
      const inputName = model.inputNames[0];
      if (!inputName) {
        throw new Error('INVALID_MODEL_OUTPUT');
      }
      const feeds = {
        [inputName]: new ort.Tensor('float32', input.data, input.dims)
      };
      const startedAt = performance.now();
      const result = await session.run(feeds);
      const inferenceTimeMs = performance.now() - startedAt;
      const outputs = Object.fromEntries(
        Object.entries(result).map(([name, tensor]) => [
          name,
          {
            dims: tensor.dims,
            data: tensor.data as Float32Array | Int32Array | BigInt64Array | Uint8Array
          }
        ])
      );
      return { provider: model.provider, outputs, inferenceTimeMs };
    }
  };
}
