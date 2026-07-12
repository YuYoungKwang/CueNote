/// <reference lib="webworker" />

const scope = self as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<{ source?: string }>) => {
  scope.postMessage({
    kind: 'image-ack',
    source: event.data.source ?? 'unknown'
  });
});

export {};
