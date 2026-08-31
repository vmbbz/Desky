import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FormattedText } from '../src/renderer/FormattedText';

describe('FormattedText', () => {
  it('renders common agent Markdown while refusing raw HTML and unsafe links', () => {
    const markup = renderToStaticMarkup(
      <FormattedText>
        {'**Done**\n\n- first\n- second\n\n[docs](https://example.com) [bad](file:///tmp/nope)\n\n<script>alert(1)</script>'}
      </FormattedText>,
    );

    expect(markup).toContain('<strong>Done</strong>');
    expect(markup).toContain('<ul>');
    expect(markup).toContain('href="https://example.com/"');
    expect(markup).not.toContain('file:///tmp/nope');
    expect(markup).not.toContain('<script>');
  });
});
