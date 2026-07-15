"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

/**
 * The newsletter body editor — TipTap (ProseMirror), matching the chatRealty CMS editor. Emits HTML
 * via onChange; email-appropriate toolbar (no code blocks / embeds). `resetKey` bumps to force the
 * content to re-seed after AI generate/revise. Image upload is self-contained: the toolbar's image
 * button opens a file picker, uploads via `onUploadImage`, and inserts the returned URL.
 */
export function TiptapEditor({
  initialHtml,
  resetKey,
  disabled,
  onChange,
  onUploadImage,
}: {
  initialHtml: string;
  resetKey: number;
  disabled?: boolean;
  onChange: (html: string) => void;
  onUploadImage: (file: File) => Promise<string | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    // Next SSR: don't render on the server (avoids hydration mismatch).
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: { openOnClick: false, HTMLAttributes: { rel: "noopener", target: "_blank" } },
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: initialHtml || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[18rem] px-3 py-3 focus:outline-none " +
          "[&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-bold " +
          "[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold " +
          "[&_p]:my-2 [&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-brand [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft " +
          "[&_a]:text-brand [&_a]:underline [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Re-seed when the AI replaces the whole draft (resetKey changes). Guarded so normal typing
  // (which doesn't change resetKey) never triggers a setContent that would move the cursor.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(initialHtml || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const onFile = async (file: File | null) => {
    if (!file || !editor) return;
    setUploading(true);
    const url = await onUploadImage(file);
    setUploading(false);
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  if (!editor) {
    return <div className="min-h-[20rem] rounded-xl border border-line bg-surface" />;
  }

  return (
    <div className="rounded-xl border border-line bg-surface focus-within:border-brand">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <Toolbar editor={editor} onInsertImageClick={() => fileRef.current?.click()} uploadingImage={uploading} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  onInsertImageClick,
  uploadingImage,
  disabled,
}: {
  editor: Editor;
  onInsertImageClick: () => void;
  uploadingImage: boolean;
  disabled?: boolean;
}) {
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev || "https://");
    if (url === null) return;
    if (url === "") { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const B = ({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
        active ? "bg-brand text-white" : "text-ink hover:bg-background"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
      <B title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><span className="font-bold">B</span></B>
      <B title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><span className="italic">I</span></B>
      <span className="mx-1 h-4 w-px bg-line" />
      <B title="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</B>
      <B title="Subheading" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</B>
      <span className="mx-1 h-4 w-px bg-line" />
      <B title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</B>
      <B title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</B>
      <B title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</B>
      <span className="mx-1 h-4 w-px bg-line" />
      <B title="Link" active={editor.isActive("link")} onClick={setLink}>🔗</B>
      <button
        type="button"
        title="Image"
        disabled={disabled || uploadingImage}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onInsertImageClick}
        className="flex h-7 items-center justify-center rounded-md px-2 text-xs font-semibold text-brand transition-colors hover:bg-brand-tint/40 disabled:opacity-40"
      >
        {uploadingImage ? "Uploading…" : "🖼 Image"}
      </button>
      <span className="mx-1 h-4 w-px bg-line" />
      <B title="Undo" onClick={() => editor.chain().focus().undo().run()}>↶</B>
      <B title="Redo" onClick={() => editor.chain().focus().redo().run()}>↷</B>
    </div>
  );
}
