import { ChevronDown } from "lucide-react";
import { DXD_HEROINES } from "./data";

/* ════════════════════════════════════════════════════════════════
   GOKAKU HEADER CONTROL DECK — upgraded header widgets
  (HeroineSwitcher • ControlButton)
   ════════════════════════════════════════════════════════════════ */

export function HeroineSwitcher({ selectedCompanion, onSelect, onAvatarClick }) {
  return (
    <div className="hc-toolbar hc-heroine" data-testid="heroine-switcher-toolbar">
      <div
        className="hc-heroine-avatar"
        dangerouslySetInnerHTML={{ __html: selectedCompanion.avatarSvg }}
        onClick={onAvatarClick}
        title={selectedCompanion.name}
        data-testid="heroine-avatar"
      />
      <select
        value={selectedCompanion.id}
        onChange={(e) => {
          const comp = DXD_HEROINES.find(c => c.id === e.target.value);
          if (comp) onSelect(comp);
        }}
        data-testid="heroine-switcher"
        className="hc-heroine-select"
        title="Choose your guide heroine"
      >
        {DXD_HEROINES.map(c => (
          <option key={c.id} value={c.id} className="bg-[#121424] text-white">
            {c.name.split(' ')[0]} ({c.piece.split(' ')[0]})
          </option>
        ))}
      </select>
      <ChevronDown className="hc-chevron" />
    </div>
  );
}

export function ControlButton({ active, onClick, title, testid, children }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      title={title}
      className={`hc-icon-btn ${active ? 'is-active' : ''}`}
    >
      {children}
    </button>
  );
}