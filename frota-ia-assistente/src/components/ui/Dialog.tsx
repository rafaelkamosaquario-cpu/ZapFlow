"use client";

import { Modal } from "./Modal";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
}

export function Dialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
}: DialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant === "danger" ? "danger" : "primary"}
          size="sm"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
