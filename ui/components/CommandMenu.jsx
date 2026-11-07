import { useRef } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem, CommandShortcut } from "./ui/command";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "./ui/drawer";
import { shortcutLabel } from "@/lib/shortcuts";

export function collectActions(showPage) {
  const commands = [];
  document.querySelectorAll("main button, main a[href], main select, main input, main textarea, aside select, aside .library-filters button").forEach((element, index) => {
    if (element.matches(":disabled, [role=tab], .review-jump, .comparison-jump, .focus-button") || element.closest(".is-loading, .review-facts")) return;
    const page = element.closest("[data-page]")?.dataset.page;
    const name = element.getAttribute("aria-label") || element.labels?.[0]?.textContent.trim()
      || element.textContent.trim().replace(/\s+/g, " ") || element.id;
    if (!name) return;
    const context = element.closest("#notes article")?.querySelector("p")?.textContent
      || element.closest(".history-entry")?.querySelector("h3")?.textContent;
    const group = { compare: "Comparison", feedback: "Feedback", evidence: "Evidence", history: "History" }[page] || "Workspace";
    const run = async (action) => {
      if (page) await showPage(page);
      const parents = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.dataset.slot === "collapsible" && parent.dataset.state === "closed") parents.unshift(parent);
      }
      for (const parent of parents) {
        const trigger = parent.querySelector(":scope > [data-slot=collapsible-trigger]");
        if (trigger !== element) trigger?.click();
      }
      requestAnimationFrame(() => {
        element.focus();
        element.scrollIntoView({ block: "nearest" });
        action();
      });
    };
    const shortcut = element.dataset.shortcut;
    if (element.tagName === "SELECT") {
      for (const option of element.options) {
        if (!option.disabled) commands.push({ id: `select-${index}-${option.value}`, label: `${name}: ${option.text}`, group, run: () => run(() => {
          element.value = option.value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }) });
      }
    } else {
      commands.push({ id: `action-${index}`, label: `${name}${context ? ` — ${context}` : ""}`,
        group, shortcut,
        run: () => run(() => {
          if (element.matches("button, a, input[type=file]")) element.click();
        }),
      });
    }
  });
  return commands;
}

export function CommandMenu({ open, commands, onClose, mobile }) {
  const pending = useRef(null);
  const restoreFocus = useRef(null);
  const input = useRef(null);
  const Root = mobile ? Drawer : Dialog;
  const Content = mobile ? DrawerContent : DialogContent;
  const Title = mobile ? DrawerTitle : DialogTitle;
  const Description = mobile ? DrawerDescription : DialogDescription;
  return <Root open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <Content className="command-surface" {...(!mobile ? { showCloseButton: false } : {})}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        restoreFocus.current = document.activeElement;
        input.current?.focus();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const run = pending.current;
        pending.current = null;
        restoreFocus.current?.focus();
        if (run) requestAnimationFrame(() => Promise.resolve().then(run).catch((error) => toast.error(error.message)));
      }}>
      <div className="command-heading"><Title>Go anywhere</Title><Button variant="ghost" size="icon" aria-label="Close command menu" onClick={onClose}><X /></Button></div>
      <Description className="sr-only">Find a screen or action. Use arrow keys to navigate and Enter to select.</Description>
      <Command loop>
        <CommandInput ref={input} aria-label="Search screens and actions" placeholder="Search screens and actions…" />
        <CommandList className="command-results">
          <CommandEmpty>No matching screens or actions</CommandEmpty>
          {commands.map((command) => <CommandItem key={command.id} value={command.id}
            keywords={[command.label, command.group]} className="command-option"
            onSelect={() => { pending.current = command.run; onClose(); }}>
            <span><span className="command-label">{command.label}</span><small>{command.group}</small></span>
            {command.shortcut && <CommandShortcut>{shortcutLabel(command.shortcut)}</CommandShortcut>}
          </CommandItem>)}
        </CommandList>
      </Command>
      <p className="command-help">↑ ↓ Navigate <span>Enter Open</span><span>Esc Close</span></p>
    </Content>
  </Root>;
}
