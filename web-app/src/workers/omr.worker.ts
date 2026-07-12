/// <reference lib="webworker" />

import { MockOMRService } from '../ai/runtime/mockOMRService';
import type { OMRSourcePage } from '../ai/runtime/types';

const scope = self as DedicatedWorkerGlobalScope;
const service = new MockOMRService();

scope.addEventListener('message', async (event: MessageEvent<{ pages?: OMRSourcePage[] }>) => {
  const pages = event.data.pages ?? [];
  const result = await service.recognize(pages);
  scope.postMessage(result);
});

export {};
