'use client';

import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { plainTextToHtml, sanitizeClinicalHtml } from '@/lib/clinical-html';

const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px'] as const;

type Props = {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  minHeightClass?: string;
};

export function ClinicalRichEditor({
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
  minHeightClass = 'min-h-[220px]',
}: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      TextStyle,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    editable: !disabled,
    content: plainTextToHtml(value || ''),
    onUpdate: ({ editor: ed }) => {
      onChange(sanitizeClinicalHtml(ed.getHTML()));
    },
    editorProps: {
      attributes: {
        class: cn(
          'clinical-editor max-w-none px-3 py-2 text-sm leading-relaxed focus:outline-none',
          '[&_p]:my-2 [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold',
          '[&_h3]:my-2 [&_h3]:text-base [&_h3]:font-semibold',
          '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_li]:my-0.5',
          minHeightClass,
        ),
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    const next = plainTextToHtml(value || '');
    if (sanitizeClinicalHtml(editor.getHTML()) === sanitizeClinicalHtml(next)) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) {
    return <div className={cn('rounded-lg border bg-muted/30', minHeightClass, className)} />;
  }

  const currentSize =
    (editor.getAttributes('textStyle').fontSize as string | undefined) || '16px';

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-background', className)}>
      {!disabled ? (
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
          <ToolBtn
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            label="Qalin"
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            label="Kursiv"
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            label="Tagiga chizish"
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            label="Sarlavha"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </ToolBtn>
          <div className="mx-1 h-5 w-px bg-border" />
          <Select
            value={
              FONT_SIZES.includes(currentSize as (typeof FONT_SIZES)[number]) ? currentSize : '16px'
            }
            onValueChange={(size) => {
              editor.chain().focus().setFontSize(size).run();
            }}
          >
            <SelectTrigger className="h-8 w-[88px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((size) => (
                <SelectItem key={size} value={size}>
                  {size.replace('px', '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolBtn
            active={editor.isActive({ textAlign: 'left' })}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            label="Chap"
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn
            active={editor.isActive({ textAlign: 'center' })}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            label="Markaz"
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn
            active={editor.isActive({ textAlign: 'right' })}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            label="O‘ng"
          >
            <AlignRight className="h-3.5 w-3.5" />
          </ToolBtn>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolBtn
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            label="Ro‘yxat"
          >
            <List className="h-3.5 w-3.5" />
          </ToolBtn>
          <ToolBtn
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            label="Raqamli"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolBtn>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label: string;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? 'secondary' : 'ghost'}
      className="h-8 w-8"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
