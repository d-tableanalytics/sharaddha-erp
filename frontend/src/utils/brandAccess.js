/**
 * The configured brand list, for the account forms on User Management.
 *
 * Brands are created in the Customer Portal (Inventory Configuration) and
 * stored in the database both portals share. This portal only ticks them on
 * accounts, so it needs the list and nothing else: it arrives with the
 * signed-in user (`/auth/me` → `brands`) and is installed by setBrandRegistry().
 * Until then it holds the three built-in brands, so a form never renders with
 * no checkboxes.
 */

const BUILT_IN = [
  { name: "Koken", key: "koken", hiddenFromMsil: false },
  { name: "BIX", key: "bix", hiddenFromMsil: false },
  { name: "IMADA", key: "imada", hiddenFromMsil: true },
];

let registry = BUILT_IN;

/**
 * Install the list the server sent. Not an array: left alone. An empty list is
 * taken as it is, so a later sign-in never keeps the previous account's list.
 */
export const setBrandRegistry = (brands) => {
  if (!Array.isArray(brands)) return;
  registry = brands
    .filter((b) => b && typeof b.name === "string" && typeof b.key === "string")
    .map((b) => ({ name: b.name, key: b.key, hiddenFromMsil: Boolean(b.hiddenFromMsil) }));
};

/** An OWN, truthy flag — an inherited property such as `constructor` never counts. */
export const hasBrandFlag = (brandAccess, key) => Boolean(
  brandAccess && typeof brandAccess === "object"
    && Object.prototype.hasOwnProperty.call(brandAccess, key) && brandAccess[key],
);

/** Every configured brand: [{ name, key, hiddenFromMsil }]. */
export const listBrands = () => registry;

export default { setBrandRegistry, listBrands, hasBrandFlag };
