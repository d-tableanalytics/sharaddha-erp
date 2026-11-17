import { useState } from "react";
import toast from "react-hot-toast";

import { Modal } from "../../../components/ui/Modal";
import { Input } from "../../../components/ui/Input";
import { Button } from "../../../components/ui/Button";
import { employeesApi } from "../../../services/hrms";
import { changeWorkEmailSchema } from "@shared/schemas/employee.js";

/**
 * Change an employee's work email after the profile was created.
 *
 * The work email is the login account's address, so this changes what the
 * employee signs in WITH - but not their password, and nobody is signed out.
 * The format rule is the shared schema the server validates against, so the
 * two cannot disagree; the duplicate check can only be answered by the server.
 */
export function EditWorkEmailDialog({ employee, onClose, onSaved }) {
  const [email, setEmail] = useState(employee.email ?? "");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const current = (employee.email ?? "").toLowerCase();

  const save = async (e) => {
    e.preventDefault();
    const parsed = changeWorkEmailSchema.safeParse({ email });
    if (!parsed.success) {
      setError("Enter a valid email address, e.g. name@company.com.");
      return;
    }
    if (parsed.data.email === current) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await employeesApi.changeWorkEmail(employee.id, parsed.data.email);
      toast.success("Work email updated. The employee now signs in with the new address and the same password.");
      onSaved(updated);
    } catch (err) {
      setError(err.message ?? "Could not change the work email.");
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={saving ? () => {} : onClose} title="Edit work email" size="sm">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <Input
          type="email"
          label="Work email"
          value={email}
          autoFocus
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder="name@company.com"
          error={error}
          helperText="This is also the address the employee signs in with."
        />
        <p className="text-xs text-slate-500">
          The password is not changed and the employee is not signed out. The new
          address is used everywhere in the ERP from now on.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !email.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default EditWorkEmailDialog;
