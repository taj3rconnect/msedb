import { describe, it, expect } from 'vitest';
import { inlineCidImages } from '../messageBody.js';

describe('inlineCidImages', () => {
  it('rewrites a cid: reference to a data: URI when a matching attachment exists', () => {
    const body = { contentType: 'html', content: '<img src="cid:abc">' };
    const attachments = [
      { contentId: 'abc', contentType: 'image/png', contentBytes: 'ZmFrZWJ5dGVz', isInline: true },
    ];

    inlineCidImages(body, attachments);

    expect(body.content).toBe('<img src="data:image/png;base64,ZmFrZWJ5dGVz">');
  });

  it('leaves the body unchanged when there is no matching attachment', () => {
    const body = { contentType: 'html', content: '<img src="cid:abc">' };
    const attachments = [
      { contentId: 'other', contentType: 'image/png', contentBytes: 'ZmFrZWJ5dGVz', isInline: true },
    ];

    inlineCidImages(body, attachments);

    expect(body.content).toBe('<img src="cid:abc">');
  });
});
