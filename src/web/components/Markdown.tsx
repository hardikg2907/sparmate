import { memo, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
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
  pre: ({ node, ...rest }) => {
    void node;
    return <ScrollablePre {...rest} />;
  },
};

/**
 * A wide block scrolls sideways, and only an element that takes focus can be scrolled from the keyboard. A block
 * that fits stays out of the tab order and out of the landmarks.
 */
function ScrollablePre(props: ComponentPropsWithoutRef<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide(el.scrollWidth > el.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [props.children]);
  return <pre ref={ref} {...props} {...(wide ? { tabIndex: 0, role: "region", "aria-label": "Code block, scrolls sideways" } : {})} />;
}

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
