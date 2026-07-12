import { createApiClient } from '../../core/api/client';

export function ApiStatusPanel() {
  const client = createApiClient('/api/v1');

  return (
    <div className="panel">
      <h2>Backend Contract</h2>
      <p>Health endpoint and envelope helpers are ready for the first integration.</p>
      <ul className="inline-list">
        <li>{client.baseUrl} health contract</li>
        <li>Common success and error responses</li>
        <li>Request ID propagation</li>
      </ul>
    </div>
  );
}
