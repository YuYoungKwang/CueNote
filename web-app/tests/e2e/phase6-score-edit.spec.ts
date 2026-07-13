import { expect, test, type Page, type Route } from '@playwright/test';

const scoreId = 'scr_phase6';
const baseVersionId = 'ver_base';
const publishedVersionId = 'ver_published';

test.describe('Phase 6 score editing', () => {
  test('edits a server MusicXML draft and publishes a new immutable version', async ({ page }) => {
    const { consoleErrors, pageErrors } = trackBrowserErrors(page);
    let publishedBody = '';
    let published = false;

    await page.addInitScript(() => {
      window.localStorage.setItem(
        'cuenote.phase4.session',
        JSON.stringify({
          user: { id: 'usr_owner', email: 'owner@cuenote.local', displayName: 'Owner' },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          accessTokenExpiresAt: '2026-07-13T12:00:00Z',
          refreshTokenExpiresAt: '2026-07-20T12:00:00Z'
        })
      );
    });

    await page.route('**/api/v1/scores/scr_phase6', (route) => fulfillJson(route, scoreDetail(published)));
    await page.route('**/api/v1/scores/scr_phase6/versions/ver_base/source', (route) => route.fulfill({ contentType: 'application/xml', body: editableXml('La') }));
    await page.route('**/api/v1/scores/scr_phase6/versions/ver_published/source', (route) =>
      route.fulfill({ contentType: 'application/xml', body: editableXml('Amen') })
    );
    await page.route('**/api/v1/scores/scr_phase6/versions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      published = true;
      publishedBody = route.request().postData() ?? '';
      await fulfillJson(route, {
        id: publishedVersionId,
        score_id: scoreId,
        version_number: 2,
        title: 'Editable Sample edited',
        content_hash: 'hash',
        byte_size: 1000,
        mime_type: 'application/xml',
        base_score_version_id: baseVersionId,
        edit_summary: 'Phase 6 edit commands: 2',
        annotation_migration_policy: 'NONE'
      });
    });

    await page.goto(`/scores/${scoreId}/edit?source=server&versionId=${baseVersionId}`);
    await expect(page.getByTestId('score-edit-ready')).toBeVisible();
    await expect(page.locator('[data-testid="score-renderer"] .score-page__surface > svg')).toHaveCount(1);
    await expect(page.getByTestId('score-edit-selected-event')).toContainText('C4');

    await page.getByTestId('score-edit-pitch-up').click();
    await expect(page.getByTestId('score-edit-selected-event')).toContainText('C#4');
    await page.getByTestId('score-edit-lyric').fill('Amen');
    await page.getByTestId('score-edit-chord').fill('Dm7');
    await expect(page.getByTestId('score-edit-dirty')).toHaveText('yes');

    await page.getByTestId('score-edit-publish').click();
    await page.waitForURL(/versionId=ver_published/);

    expect(publishedBody).toContain('baseScoreVersionId');
    expect(publishedBody).toContain(baseVersionId);
    expect(publishedBody).toContain('<alter>1</alter>');
    expect(publishedBody).toContain('<text>Amen</text>');
    expect(publishedBody).toContain('Dm7');
    await expect(page.getByTestId('score-viewer-ready')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

function scoreDetail(published: boolean) {
  return {
    id: scoreId,
    ensemble_id: 'ens_phase6',
    title: 'Editable Sample',
    composer: 'CueNote',
    current_version_id: published ? publishedVersionId : baseVersionId,
    current_version_number: published ? 2 : 1,
    revision: published ? 2 : 1,
    versions: [
      {
        id: baseVersionId,
        score_id: scoreId,
        version_number: 1,
        title: 'Editable Sample',
        content_hash: 'base',
        byte_size: 1000,
        mime_type: 'application/xml'
      },
      ...(published
        ? [
            {
              id: publishedVersionId,
              score_id: scoreId,
              version_number: 2,
              title: 'Editable Sample edited',
              content_hash: 'published',
              byte_size: 1000,
              mime_type: 'application/xml',
              base_score_version_id: baseVersionId,
              edit_summary: 'Phase 6 edit commands: 2',
              annotation_migration_policy: 'NONE'
            }
          ]
        : [])
    ]
  };
}

function editableXml(lyric: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Editable Sample</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1" xml:id="m1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <harmony><root><root-step>C</root-step></root><kind text="C">major</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><lyric><text>${lyric}</text></lyric></note>
      <note><rest/><duration>12</duration><type>half</type><dot/></note>
    </measure>
  </part>
</score-partwise>`;
}

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { requestId: 'req_phase6' } })
  });
}

function trackBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}
