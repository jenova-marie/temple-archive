import { useThemeStore, COLOR_PRESETS } from '@/stores/themeStore'
import { cn } from '@/lib/utils'
import { CheckIcon, PaletteIcon } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

export function ColorPicker() {
  const primaryHue = useThemeStore((s) => s.primaryHue)
  const setPrimaryHue = useThemeStore((s) => s.setPrimaryHue)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Choose accent color"
        >
          <PaletteIcon className="h-5 w-5" />
          {/* Color indicator dot */}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background"
            style={{ backgroundColor: `oklch(0.65 0.15 ${primaryHue})` }}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Accent Color</p>
          <div className="grid grid-cols-5 gap-2">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => setPrimaryHue(preset.hue)}
                className={cn(
                  'group relative flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
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
          {/* Hue slider for custom colors */}
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
      </PopoverContent>
    </Popover>
  )
}
