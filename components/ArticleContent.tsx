import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Keep legacy plain-text section titles while supporting real Markdown blocks.
export function normalizeArticleContent(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const trimmed = line.trim();
    const bold = trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return `## ${bold[1]}`;
    if (/^[^#|>*\d-].{5,100}:$/.test(trimmed)) return `## ${trimmed.slice(0, -1)}`;
    return line;
  }).join("\n");
}

export default function ArticleContent({ content }: { content: string }) {
  return (
    <div className="space-y-4 text-base leading-7 text-gray-800">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
        h1: ({ children }) => <h2 className="pt-4 text-2xl font-bold">{children}</h2>,
        h2: ({ children }) => <h2 className="pt-4 text-xl font-bold md:text-2xl">{children}</h2>,
        h3: ({ children }) => <h3 className="pt-3 text-lg font-bold md:text-xl">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc space-y-2 pl-6">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal space-y-2 pl-6">{children}</ol>,
        table: ({ children }) => <div className="max-w-full overflow-x-auto rounded-xl border"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border-b bg-gray-50 px-4 py-3 font-semibold">{children}</th>,
        td: ({ children }) => <td className="border-b px-4 py-3 align-top">{children}</td>,
        a: ({ href, children }) => <a href={href} className="break-words underline underline-offset-2" rel="noopener noreferrer">{children}</a>,
        blockquote: ({ children }) => <blockquote className="border-l-4 pl-4 text-gray-600">{children}</blockquote>,
        img: ({ src, alt }) => <img src={src} alt={alt || ""} loading="lazy" className="max-w-full rounded-xl" />,
      }}>{normalizeArticleContent(content)}</Markdown>
    </div>
  );
}
