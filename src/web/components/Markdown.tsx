import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "./ui";

// Model output is untrusted. There is no raw-HTML plugin, links leave in a new tab without the opener,
// and images are shown as text so a reply cannot make the page fetch anything.
const components: Components = {
  a: ({ node, href, children, ...rest }) => {
    void node;
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img: ({ alt }) => (alt ? <span className="italic text-muted-foreground">[image: {alt}]</span> : null),
};

const PLUGINS = [remarkGfm];

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
