import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";

type PromptViewerModalProps = {
  prompt: string;
  title?: string;
  onClose: () => void;
};

export default function PromptViewerModal({ prompt, title = "完整提示词", onClose }: PromptViewerModalProps) {
  const [copied, setCopied] = useState(false);
  const displayPrompt = prompt.trim() || "暂无提示词";

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    await navigator.clipboard.writeText(displayPrompt);
    setCopied(true);
  }

  return (
    <div className="prompt-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="prompt-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="prompt-modal-head">
          <div>
            <h3>{title}</h3>
            <p>这里显示任务实际保存的完整 prompt。</p>
          </div>
          <button className="prompt-modal-close" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <pre className="prompt-modal-text">{displayPrompt}</pre>
        <div className="prompt-modal-actions">
          <button className="mini-action" type="button" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制"}
          </button>
          <button className="mini-action muted" type="button" onClick={onClose}>关闭</button>
        </div>
      </section>
    </div>
  );
}
