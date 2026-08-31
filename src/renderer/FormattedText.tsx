import ReactMarkdown, { type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FormattedTextProps {
  children: string;
  className?: string;
}

const safeUrlTransform: UrlTransform = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
};

export function FormattedText({ children, className }: FormattedTextProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrlTransform}
        components={{
          a: ({ href, children: linkChildren }) => href
            ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  void window.desky.openExternalLink(href).catch(() => undefined);
                }}
              >
                {linkChildren}
              </a>
            )
            : <span>{linkChildren}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
