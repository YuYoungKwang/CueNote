export interface LayoutModelDescriptor {
  name: string;
  version: string;
  provider: 'webgpu' | 'wasm' | 'mock';
}

export const defaultLayoutModel: LayoutModelDescriptor = {
  name: 'layout',
  version: '0.1.0',
  provider: 'mock'
};
