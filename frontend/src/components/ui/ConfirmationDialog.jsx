import { Button } from "./Button";
import { Modal } from "./Modal";

export const ConfirmationDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  loading = false,
  variant = "primary",
  /**
   * The action is blocked by something the dialog can already see.
   *
   * For when a dependency makes the answer "no" before the request is sent —
   * a role somebody still holds, a department with employees on it. Leaving
   * the button live in that case spends a round trip to be told what the
   * screen already knew. Defaults to false, so every existing caller is
   * unchanged.
   */
  confirmDisabled = false,
}) => {
  return (
    // While the confirmed action is in flight the dialog can't be dismissed —
    // the backdrop and close button would otherwise hide a running request and
    // leave the user unsure whether it went through.
    <Modal isOpen={isOpen} onClose={loading ? () => {} : onClose} title={title} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
        <div className="flex justify-end gap-3 mt-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
