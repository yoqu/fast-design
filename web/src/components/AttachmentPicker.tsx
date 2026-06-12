import { useRef } from 'react';
import { FileIcon, PaperclipIcon, XIcon } from './icons';

type Props = {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  /** 添加按钮的文案；省略时只显示回形针图标。 */
  addLabel?: string;
};

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 项目创建前的本地附件暂存选择器（快速简报用）：文件先留在内存里，
 * 项目创建成功后再统一上传到 uploads/ 并写入 pendingAttachments。
 */
export default function AttachmentPicker({ files, onChange, disabled, addLabel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onChange([...files, ...Array.from(e.target.files)]);
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700"
            >
              <FileIcon size={13} className="shrink-0 text-zinc-400" />
              <span className="max-w-36 truncate font-medium">{f.name}</span>
              <span className="text-[11px] text-zinc-400">{formatSize(f.size)}</span>
              <button
                type="button"
                title="移除附件"
                aria-label={`移除附件 ${f.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
              >
                <XIcon size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        title="添加附件"
        aria-label="添加附件"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40"
      >
        <PaperclipIcon size={13} />
        {addLabel}
      </button>
    </>
  );
}
