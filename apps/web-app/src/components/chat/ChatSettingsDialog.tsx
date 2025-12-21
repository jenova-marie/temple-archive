import { type FC } from "react"
import { CheckIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useChatStore, GUIDES } from "@/stores/chatStore"
import { useAuthStore } from "@/stores/authStore"
import { useThemeStore, COLOR_PRESETS } from "@/stores/themeStore"
import { cn } from "@/lib/utils"

interface ChatSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const ChatSettingsDialog: FC<ChatSettingsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const selectedGuideId = useChatStore((s) => s.selectedGuideId)
  const setGuide = useChatStore((s) => s.setGuide)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const primaryHue = useThemeStore((s) => s.primaryHue)
  const setPrimaryHue = useThemeStore((s) => s.setPrimaryHue)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chat Settings</DialogTitle>
          <DialogDescription>
            Customize your chat experience
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Guide Selection - Premium feature */}
          {isAuthenticated && (
            <div className="space-y-2">
              <label
                htmlFor="settings-guide-select"
                className="text-sm font-medium text-foreground"
              >
                AI Guide
              </label>
              <p className="text-xs text-muted-foreground">
                Choose your preferred AI personality
              </p>
              <select
                id="settings-guide-select"
                value={selectedGuideId}
                onChange={(e) => setGuide(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {GUIDES.map((guide) => (
                  <option key={guide.id} value={guide.id}>
                    {guide.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isAuthenticated && (
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">
                Sign in to unlock premium guides and personalized features.
              </p>
            </div>
          )}

          {/* Accent Color */}
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-foreground">
                Accent Color
              </label>
              <p className="text-xs text-muted-foreground">
                Customize the app's accent color
              </p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => setPrimaryHue(preset.hue)}
                  className={cn(
                    "group relative flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                  style={{ backgroundColor: `oklch(0.65 0.15 ${preset.hue})` }}
                  title={preset.name}
                  aria-label={`Select ${preset.name} color`}
                >
                  {primaryHue === preset.hue && (
                    <CheckIcon className="h-4 w-4 text-white drop-shadow-md" />
                  )}
                </button>
              ))}
            </div>
            {/* Custom hue slider */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <label htmlFor="hue-slider" className="text-xs text-muted-foreground">
                  Custom
                </label>
                <span className="text-xs font-mono text-muted-foreground">
                  {primaryHue}°
                </span>
              </div>
              <input
                id="hue-slider"
                type="range"
                min="0"
                max="360"
                value={primaryHue}
                onChange={(e) => setPrimaryHue(Number(e.target.value))}
                className="w-full h-3 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right,
                    oklch(0.65 0.15 0),
                    oklch(0.65 0.15 60),
                    oklch(0.65 0.15 120),
                    oklch(0.65 0.15 180),
                    oklch(0.65 0.15 240),
                    oklch(0.65 0.15 300),
                    oklch(0.65 0.15 360)
                  )`,
                }}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
