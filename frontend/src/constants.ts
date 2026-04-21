export const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  TAXES:     { label: 'Налоги',     color: 'red'      },
  SALARY:    { label: 'Зарплата',   color: 'green'    },
  BANK:      { label: 'Банк',       color: 'blue'     },
  TRANSPORT: { label: 'Транспорт',  color: 'orange'   },
  SUPPLIERS: { label: 'Поставщики', color: 'geekblue' },
  OTHER:     { label: 'Прочее',     color: 'default'  },
};

// Все типы — для отображения и редактирования отдельных дней календаря
export const DAY_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  PAYMENT:     { label: 'Платёжный', color: 'blue',    bg: '#e6f4ff' },
  SALARY_DAY:  { label: 'День ЗП',   color: 'green',   bg: '#f6ffed' },
  NON_PAYMENT: { label: 'Неплатёжный', color: 'default', bg: '#fafafa' },
  HOLIDAY:     { label: 'Выходной',  color: 'red',     bg: '#fff1f0' },
};

// Для шаблона недели: Платёжный, Нерабочий, Выходной (День ЗП — только вручную в календаре)
export const TEMPLATE_DAY_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  PAYMENT:     { label: 'Платёжный', color: 'blue'    },
  NON_PAYMENT: { label: 'Неплатёжный', color: 'default' },
  HOLIDAY:     { label: 'Выходной',  color: 'red'     },
};

// Порядок смены типа при клике по ячейке календаря (все 4 типа)
export const DAY_TYPE_CYCLE: string[] = ['NON_PAYMENT', 'PAYMENT', 'HOLIDAY', 'SALARY_DAY'];

export const DAY_NAMES: Record<number, string> = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
  7: 'Воскресенье',
};

export const DAY_SHORT: Record<number, string> = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Вс',
};

export const MONTH_NAMES: string[] = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// Локаль для antd DatePicker — передавать явно в locale проп каждого DatePicker/RangePicker
// В antd v6 ConfigProvider locale не применяется к DatePicker автоматически
export const DATE_PICKER_LOCALE = {
  lang: {
    locale: 'ru_RU',
    placeholder: 'Выберите дату',
    yearPlaceholder: 'Выберите год',
    monthPlaceholder: 'Выберите месяц',
    rangePlaceholder: ['Начальная дата', 'Конечная дата'] as [string, string],
    today: 'Сегодня',
    now: 'Сейчас',
    backToToday: 'Текущая дата',
    ok: 'ОК',
    clear: 'Очистить',
    month: 'Месяц',
    year: 'Год',
    previousMonth: 'Предыдущий месяц',
    nextMonth: 'Следующий месяц',
    monthSelect: 'Выбрать месяц',
    yearSelect: 'Выбрать год',
    decadeSelect: 'Выбрать десятилетие',
    yearFormat: 'YYYY',
    dayFormat: 'D',
    dateFormat: 'D MMMM YYYY',
    dateTimeFormat: 'D MMMM YYYY HH:mm:ss',
    previousYear: 'Предыдущий год',
    nextYear: 'Следующий год',
    previousDecade: 'Предыдущее десятилетие',
    nextDecade: 'Следующее десятилетие',
    previousCentury: 'Предыдущий век',
    nextCentury: 'Следующий век',
    shortWeekDays: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
    shortMonths: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
    weekStart: 1,
  },
  timePickerLocale: { placeholder: 'Выберите время' },
} as any;
