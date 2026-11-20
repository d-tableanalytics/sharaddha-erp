/**
 * The default salary, in one place.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE FIGURE COMES FROM
 * ---------------------------------------------------------------------------
 * The client's Salary sheet says, in full: "Put 10,000/- as salary for all".
 * That instruction arrived with the workbook and is now also the system-wide
 * default for an employee whose compensation nobody has set.
 *
 * ---------------------------------------------------------------------------
 * 🔴 TEN THOUSAND A MONTH, STORED AS ONE LAKH TWENTY THOUSAND A YEAR
 * ---------------------------------------------------------------------------
 * `EmployeeCompensation.ctc` is ANNUAL cost to company — the field is labelled
 * "Annual CTC" and every payroll computation divides it by twelve. The
 * instruction gives a bare number with no basis, and the two readings differ by
 * a factor of twelve:
 *
 *     monthly -> Rs 1,20,000 a year  -> Rs 10,000 a month
 *     annual  -> Rs 10,000 a year    -> about Rs 833 a month
 *
 * The second is below any Indian minimum wage, so MONTHLY is the reading this
 * system uses. It is written down here, with the arithmetic, because "10,000"
 * on its own has silently meant both at different points in this codebase's
 * life and the next person to read it deserves better than a bare constant.
 *
 * ---------------------------------------------------------------------------
 * STRINGS, NOT NUMBERS
 * ---------------------------------------------------------------------------
 * AD-2: money never passes through a float. These are the exact decimal strings
 * `Decimal128.fromString` is given, which is also what `moneyString` validates.
 */

/** The bare figure from the client's instruction, for messages. */
export const DEFAULT_SALARY_INSTRUCTION = '10000';

/** Rs 10,000 — the default MONTHLY salary. */
export const DEFAULT_MONTHLY_SALARY = '10000.00';

/** The same figure as the ANNUAL CTC the database stores. 10,000 x 12. */
export const DEFAULT_ANNUAL_CTC = '120000.00';

/**
 * The two readings of a bare salary figure.
 *
 * Kept as a table rather than folded away, because the importer offers
 * `--ctc-basis` and has to be able to describe each choice back to whoever runs
 * it. `monthly` is the default everywhere; `annual` exists so a deliberate
 * choice can still be made.
 */
export const CTC_BASIS = Object.freeze({
  monthly: {
    annual: DEFAULT_ANNUAL_CTC,
    describe: 'Rs 10,000 per month -> Rs 1,20,000 annual CTC',
  },
  annual: {
    annual: '10000.00',
    describe: 'Rs 10,000 per year -> about Rs 833 per month',
  },
});

/** The basis used when nobody says otherwise. */
export const DEFAULT_CTC_BASIS = 'monthly';

export default {
  DEFAULT_SALARY_INSTRUCTION,
  DEFAULT_MONTHLY_SALARY,
  DEFAULT_ANNUAL_CTC,
  CTC_BASIS,
  DEFAULT_CTC_BASIS,
};
