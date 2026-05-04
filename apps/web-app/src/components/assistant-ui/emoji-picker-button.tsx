"use client";

import { type FC, useCallback, useEffect, useState } from "react";
import { SmileIcon } from "lucide-react";
import { useComposerRuntime } from "@assistant-ui/react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TooltipIconButton } from "./tooltip-icon-button";

const COMPOSER_TEXTAREA_SELECTOR = 'textarea[aria-label="Message input"]';

/** Watch the html element for `.dark` class so we can flip emoji-mart's theme. */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : true,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const update = () => setIsDark(html.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

interface EmojiSelectPayload {
  native: string;
}

export const EmojiPickerButton: FC = () => {
  const composer = useComposerRuntime();
  const isDark = useIsDark();
  const [open, setOpen] = useState(false);

  const handleEmojiSelect = useCallback(
    (emoji: EmojiSelectPayload) => {
      const native = emoji?.native ?? "";
      if (!native) return;

      const currentText = composer.getState().text ?? "";
      const textarea = document.querySelector<HTMLTextAreaElement>(
        COMPOSER_TEXTAREA_SELECTOR,
      );

      // If the composer textarea has a known cursor position, insert
      // there. Otherwise just append — same fallback the voice input
      // uses.
      if (
        textarea &&
        typeof textarea.selectionStart === "number" &&
        typeof textarea.selectionEnd === "number"
      ) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newText =
          currentText.slice(0, start) + native + currentText.slice(end);
        composer.setText(newText);

        // Restore cursor after the inserted emoji (next frame so the
        // textarea has had a chance to re-render with the new value).
        requestAnimationFrame(() => {
          textarea.focus();
          const pos = start + native.length;
          textarea.setSelectionRange(pos, pos);
        });
      } else {
        composer.setText(currentText + native);
      }

      setOpen(false);
    },
    [composer],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TooltipIconButton
          tooltip="Insert emoji"
          side="top"
          variant="ghost"
          size="icon"
          className="aui-emoji-picker size-[34px] rounded-full p-1"
          aria-label="Insert emoji"
        >
          <SmileIcon className="size-5" />
        </TooltipIconButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        // Strip the default padding/border/shadow — emoji-mart provides
        // its own chrome.
        className="aui-emoji-popover w-auto border-0 bg-transparent p-0 shadow-none"
        // Don't auto-focus the popover wrapper; let emoji-mart's search
        // input grab focus instead.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Picker
          data={data}
          onEmojiSelect={handleEmojiSelect}
          theme={isDark ? "dark" : "light"}
          previewPosition="none"
          skinTonePosition="search"
          maxFrequentRows={2}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
};
