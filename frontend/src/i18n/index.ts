import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './ru.json';

/**
 * i18n SCAFFOLD (audit #21).
 *
 * This wires up react-i18next as a hedge for possible future multi-company
 * tiraging. The app is Russian-only today, so:
 *   - lng + fallbackLng are both 'ru'
 *   - every value in ru.json is byte-identical to the previously hardcoded
 *     string, so the rendered UI does NOT change.
 *
 * Only the Login screen is migrated as the established pattern. Remaining
 * screens stay hardcoded Russian for now; migrating them is a mechanical
 * follow-up (wrap strings in t(), add keys to ru.json).
 */
void i18n
  .use(initReactI18next)
  .init({
    lng: 'ru',
    fallbackLng: 'ru',
    resources: {
      ru: { translation: ru },
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
