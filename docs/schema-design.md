# Схемы нод: анализ PumpkinQuest и проект

Источник: `PumpkinQuest/Assets/Scripts/DialogueSystem` — модели нод (`Nodes/`), их вьюхи и вьюмодели
(`Nodes/Editor/`), baked-формат (`BakedGraph/`), данные ресурсов (`Data/`), локализация.

---

## 1. Инвентаризация нод

Обозначения портов: `flow` — поток диалога (в Unity `AbstractNode`), `bool` — условие (`BoolNode`),
`choice` — связь «вопрос → варианты ответа» (`MultipleChoiceNode`). `1` — один линк, `N` — много.

### Поток (void-ноды)

| Нода | Меню | Блокирует | Входы | Выходы | Поля |
|---|---|---|---|---|---|
| Start | Dialogue/Start | нет | — | `Output` flow 1 | — (имя фиксировано «Start», одна на граф) |
| End | Dialogue/End | нет | `Input` flow | — | `EndingType`: enum `GoToMainMenu` / `Restart` (имя фиксировано «End») |
| Set Background | Dialogue/Set Background | нет | `Input` flow | `Output` flow | `Background`: ресурс *background* + превью (высота 140) |
| No Choice (реплика) | Dialogue/Choice/No Choice | **да** | `Input` flow | `Output` flow | `Speaker`: ресурс *character*; `Emotion`: эмоция спикера; `Line`: локализованный текст; превью персонажа (255) |
| Multiple Choice (вопрос) | Dialogue/Choice/Multiple Choice | **да** | `Input` flow | `Output` choice | как у No Choice |
| Multiple Choice Option (ответ) | Dialogue/Choice/Multiple Choice Option | нет | `Input` choice, `Condition` bool | `Output` flow | `IsExtraChoice`: bool; `Line`: локализованный текст |
| Add Diary Entry | Dialogue/Add Diary Entry | нет | `Input` flow | `Output` flow | `Entry`: ресурс *diary entry* |
| Strikethrough Diary Entry | Dialogue/Strikethrough Diary Entry | нет | `Input` flow | `Output` flow | `Entry`: ресурс *diary entry* |
| Add Relationship Points | Dialogue/Add Relationship Points | нет | `Input` flow | `Output` flow | `Character`: ресурс *character* + превью; `PointsToAdd`: int |
| Change Variable | Dialogue/Change Variable | нет | `Input` flow | `Output` flow | `Name`: string (имя переменной); `ValueToAdd`: int |
| Play Music | Dialogue/Audio/Play Music | нет | `Input` flow | `Output` flow | `Music`: ресурс *music* |
| Play Sfx | Dialogue/Audio/Play Sfx | нет | `Input` flow | `Output` flow | `Sfx`: ресурс *sfx* |
| Hide UI | Dialogue/UI/Hide UI | **да** | `Input` flow | `Output` flow | — |
| If | Dialogue/Conditional/If | нет | `Input` flow, `Condition` bool | `True` flow 1, `False` flow 1 | — |
| Choice Matrix | Dialogue/Choice/Choice Matrix | нет | `Input` flow | `Output 0..K-1` + `Default` (динамические) | `Choices`: список ссылок на ноды-ответы (≤30); `OutcomesCount`: int (≤30); `States`: bool-матрица K×C |

### Условия (bool-ноды, не блокируют, не переименовываются)

| Нода | Входы | Выходы | Поля |
|---|---|---|---|
| And | `Conditions` bool N | `Output` bool | — |
| Or | `Conditions` bool **1** (!) | `Result` bool | — |
| Not | `Condition` bool | `Result` bool | — |
| Choice Was Made | — | `Result` **flow** (!) | `Choice`: ссылка на ноду-ответ |
| Choices Were Made | — | `Result` bool | `Choices`: список ссылок на ноды-ответы (≤15); `States`: bool-вектор той же длины |
| Relationship Point Comparer | — | `Output` bool | `Character`: ресурс *character* + превью; `Comparison`; `TargetValue`: int |
| Variable Comparer | — | `Output` bool | `Name`: string; `Comparison`; `TargetValue`: int |

`Comparison` — сегментированная кнопка `=  ≠  >  ≥  <  ≤`, выбор одного значения.

### Что похоже на баги в текущей реализации

- **Or**: `Conditions` без `allowMultiple` — принимает одно условие, в отличие от And.
- **Choice Was Made**: выход `Result` типизирован как flow (`AbstractNode`), а не bool — его нельзя воткнуть в `Condition`.
- `Comparison` объявлен `[Flags]`, но UI выбирает одно значение — флаги не нужны.
- Меню «Choice Were Made» — опечатка.
- Входы в NodeGraphProcessor по умолчанию одиночные; если в диалоге ветки сходятся в одну реплику, flow-входы должны быть `N`. **Нужно подтвердить.**

---

## 2. Каталог полей

Всё, что видит и редактирует человек, сводится к этим типам. Они и станут словарём схем.

### Поля данных

| Тип | Где встречается | Значение в файле | Поведение редактора |
|---|---|---|---|
| `int` | PointsToAdd, ValueToAdd, TargetValue | число | min/max опционально |
| `string` | Change Variable / Variable Comparer: Name | строка | однострочный ввод; в будущем — выбор из списка известных переменных |
| `bool` | IsExtraChoice | true/false | чекбокс |
| `enum` | EndingType, Comparison | строка-идентификатор | выпадающий список или сегментированная кнопка (`display`), подписи отдельно от значений (`≥` ↔ `GreaterOrEqual`) |
| `resource` | Speaker, Character, Background, Music, Sfx, Entry | id ресурса | выпадающий список из библиотеки ресурсов по типу, с миниатюрами; пустое значение «None» |
| `resourceVariant` | Emotion | id варианта | варианты берутся из ресурса, выбранного в другом поле; скрыто, пока ресурс не выбран; при смене ресурса сбрасывается на значение по умолчанию, если старое не подходит |
| `localizedText` | Line | ключ + тексты по языкам | ключ по умолчанию = имя ноды; многострочное поле на каждый язык (сейчас показывается только русский) |
| `nodeRef` | Choice | id ноды | выбор ноды нужной схемы через поиск; при удалении ноды-цели значение очищается; показывает имя цели |
| `list` | Choices; Choices + States | массив элементов | добавить/удалить/переставить, `maxItems`; элемент — любой тип поля или запись из нескольких полей |
| `matrix` | States в Choice Matrix | двумерный массив bool | число строк и столбцов привязано к другим полям; при изменении размера значения сохраняются; подписи строк/столбцов по шаблону (`O{i}`, `C{j}`) |

### Свойства самой ноды

| Свойство | Примеры |
|---|---|
| Имя ноды | Для реплик уникальное и проверяется регуляркой, а автоимя строится по схеме `глава.номер` (`1.12`). У Start/End имя фиксированное. Условия не переименовываются |
| Цвет, путь в меню | у каждой ноды |
| Единственность | Start — одна на граф |
| Произвольные метаданные для игры | `NodeType`: `Blocking` / `NonBlocking` — редактору не нужен, просто уходит в экспорт |

### Элементы вьюхи (не данные)

| Элемент | Где |
|---|---|
| Превью картинки ресурса | персонаж (idle-спрайт, высота 255), фон (140) |
| Заглушка, когда ресурс не выбран | «Character is not selected», «Background is not selected» |
| Заголовок секции, разделитель, сворачиваемая секция | Localization, Character preview, Choices, Matrix |
| Условная видимость | эмоция и превью видны только при выбранном персонаже |
| Отладочная информация | ID ноды, ключ локализации |

### Порты

| Свойство | Примеры |
|---|---|
| Тип и совместимость | flow↔flow, bool↔bool, choice↔choice (вопрос → ответ) |
| Вместимость | If.True/False и Start.Output — 1; And.Conditions — N |
| Динамические порты | Choice Matrix: `Output 0..K-1` по значению поля + фиксированный `Default` |

---

## 3. Проект: редактор-пустышка + пакет схем

Редактор знает только перечисленные выше **примитивы**. Всё предметное — ноды, типы портов,
ресурсы, эмоции — приходит из **пакета схем** (папки с JSON), который пользователь подключает к проекту.

```
pumpkin-quest.schemas/
  pack.json              # id пакета, языки, типы портов, типы ресурсов
  nodes/*.json           # схемы нод
  views/*.json           # схемы вьюх (необязательны)
  resources/
    library.json         # ресурсы: персонажи, фоны, музыка, ...
    characters/arleen/idle.png ...
```

### 3.1 `pack.json`

```json
{
  "id": "pumpkin-quest",
  "version": 1,
  "languages": ["ru", "en"],
  "portTypes": {
    "flow":   { "color": "#b8bcc5" },
    "bool":   { "color": "#e07a6f" }
  },
  "resourceTypes": {
    "character":  { "label": "Characters",   "variants": { "emotions": { "label": "Emotion", "default": "Idle" } } },
    "background": { "label": "Backgrounds" },
    "music":      { "label": "Music",  "media": "audio" },
    "sfx":        { "label": "Sfx",    "media": "audio" },
    "diaryEntry": { "label": "Diary" }
  }
}
```

### 3.2 Схема ноды

Схема описывает данные и порты. Как это выглядит на экране — забота схемы вьюхи или автовьюхи.

```json
{
  "id": "dialogue.line",
  "version": 1,
  "title": "Line",
  "menu": "Dialogue/Choice",
  "color": "#508cdc",
  "naming": { "unique": true, "pattern": "^[\\p{L}0-9 ,.']+$", "auto": "{chapter}.{index}" },
  "meta": { "nodeType": "Blocking" },
  "ports": [
    { "id": "in",  "direction": "input",  "type": "flow", "capacity": "multiple" },
    { "id": "out", "direction": "output", "type": "flow", "capacity": "multiple" }
  ],
  "fields": [
    { "id": "speaker", "type": "resource", "resourceType": "character", "label": "Character" },
    { "id": "emotion", "type": "resourceVariant", "source": "speaker", "collection": "emotions", "label": "Emotion" },
    { "id": "line",    "type": "localizedText", "keyFrom": "name", "multiline": true, "label": "Line" }
  ],
  "view": "dialogue-line"
}
```

Пример упрощён, выборов в нём нет. Полная схема ноды реплики с выборами — в разделе 6.

Choice Matrix — динамические порты и матрица, привязанные к полям:

```json
{
  "id": "dialogue.choice-matrix",
  "title": "Choice Matrix",
  "menu": "Dialogue/Choice",
  "ports": [
    { "id": "in",      "direction": "input",  "type": "flow" },
    { "id": "outcome", "direction": "output", "type": "flow", "repeat": { "count": "outcomes", "label": "Output {i}" } },
    { "id": "default", "direction": "output", "type": "flow", "label": "Default" }
  ],
  "fields": [
    { "id": "choices",  "type": "list", "maxItems": 30, "item": { "type": "itemRef", "schema": "dialogue.line", "list": "choices" } },
    { "id": "outcomes", "type": "int", "min": 0, "max": 30, "label": "Outcomes" },
    { "id": "states",   "type": "matrix", "cell": "bool", "rows": "outcomes", "columns": "choices",
      "rowLabel": "O{i}", "columnLabel": "C{i}" }
  ]
}
```

Choices Were Made: вместо двух параллельных массивов — список записей `{ choice, made }`:

```json
{ "id": "choices", "type": "list", "maxItems": 15,
  "item": { "type": "record", "fields": [
    { "id": "choice", "type": "itemRef", "schema": "dialogue.line", "list": "choices" },
    { "id": "made",   "type": "bool", "default": true }
  ] } }
```

Ссылки между полями — только по `id` поля (`"rows": "outcomes"`, `"source": "speaker"`). Встроенного языка
выражений нет: всё, что нельзя описать такой привязкой, — повод добавить в редактор новый примитив.

### 3.3 Схема вьюхи

Если у схемы нет `view`, редактор строит вьюху сам: поля по порядку, превью для ресурсов с картинкой.
Своя вьюха — это список элементов:

```json
{
  "id": "dialogue-line",
  "body": [
    { "field": "speaker" },
    { "field": "emotion", "visibleIf": { "set": "speaker" } },
    { "divider": true },
    { "heading": "Localization" },
    { "field": "line" },
    { "divider": true },
    { "heading": "Character preview" },
    { "image": { "resource": "speaker", "variant": "emotion" }, "height": 255,
      "emptyText": "Character is not selected" }
  ]
}
```

Элементы: `field`, `heading`, `divider`, `group` (сворачиваемая секция), `image` (превью ресурса или
его варианта), `text` (статичная подпись). Условие видимости: `set` / `equals`.

### 3.4 Библиотека ресурсов и эмоции

**Эмоции — это частный случай «вариантов ресурса».** Редактор не знает слова «эмоция». Он знает,
что у ресурса могут быть именованные наборы вариантов, и у каждого варианта — id и картинка. Тип
ресурса `character` объявляет набор `emotions`, конкретный персонаж перечисляет свои эмоции.
Поле `resourceVariant` показывает варианты того ресурса, который выбран в поле `source`.

```json
{
  "items": [
    {
      "id": "3f2c…",
      "type": "character",
      "name": "Arleen",
      "image": "characters/arleen/idle.png",
      "variants": {
        "emotions": [
          { "id": "Idle",            "image": "characters/arleen/idle.png" },
          { "id": "Arleen_Laughter", "image": "characters/arleen/laughter.png" },
          { "id": "Arleen_Sadness",  "image": "characters/arleen/sadness.png" }
        ]
      },
      "properties": { "isMainCharacter": true }
    },
    { "id": "9a1d…", "type": "background", "name": "Forest", "image": "backgrounds/forest.png" },
    { "id": "77be…", "type": "music", "name": "Theme", "file": "music/theme.ogg" }
  ]
}
```

Что это даёт:
- Список эмоций зависит от выбранного персонажа — так работает и сейчас.
- Превью может показывать **выбранную** эмоцию, а не только idle.
- Новая эмоция — это новая строка в `library.json`, без правки enum и перекомпиляции.
- В игру уходит строковый id варианта. `Enum.Parse<CharacterEmotion>` на стороне Unity продолжит
  работать, а позже enum можно заменить строками.

Источник правды для ресурсов — редактор: GUID ресурсов выдаёт он, Unity импортирует библиотеку
вместе с id. Как переносить уже существующие ассеты PumpkinQuest (сохраняя их `_id`), решим вместе
с экспортом.

### 3.5 Файл графа

Файл хранит ссылку на пакет, id и версию схемы, данные и связи. Порты адресуются id из схемы, а не
собственным GUID порта: набор портов выводится из схемы и данных. Повторяющиеся порты получают
суффикс — GUID элемента списка (`choice:<GUID>`) или номер, если порты повторяются по числу
(`outcome:2` у Choice Matrix).

```json
{
  "format": "node-graph",
  "version": 2,
  "pack": { "id": "pumpkin-quest", "version": 1 },
  "localization": "localization",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [
    {
      "id": "b0d1…",
      "schema": "dialogue.line",
      "schemaVersion": 1,
      "name": "1.12",
      "position": { "x": 120, "y": 40 },
      "data": {
        "speaker": "3f2c…",
        "emotion": "Arleen_Laughter",
        "line": "1.12"
      }
    }
  ],
  "connections": [
    { "id": "c9…", "from": { "node": "b0d1…", "port": "out" }, "to": { "node": "e4…", "port": "in" } },
    { "id": "d2…", "from": { "node": "a7…", "port": "outcome:2" }, "to": { "node": "e4…", "port": "in" } }
  ]
}
```

Если схема не найдена или версия не совпадает, нода грузится заглушкой, а данные сохраняются
как есть — механизм плейсхолдеров уже есть. Связь на исчезнувший порт (например, после уменьшения
`outcomes`) не удаляется молча: она уходит в `unresolvedConnections`, как сейчас.

---

## 4. Принятые решения

1. **Контролы — прямо на нодах**, как в Unity: нужно видеть всё на графе. Отрисовка остаётся в Pixi
   (текст, картинки, значения). Редактирование открывается DOM-поповером поверх ноды по клику —
   выпадающий список, поиск ноды, многострочный текст, — как уже сделано для числового поля. На мелком
   зуме детали скрываются (LOD), так что 1000 нод остаются быстрыми.
2. **Локализация — отдельный JSON на язык**: `localization/ru.json`, `localization/en.json`,
   формат `{ "ключ": "текст" }`. Граф хранит только ключи; нода редактирует текст прямо в файле языка.
3. **Импортёр в Unity** — позже.
4. **Источник правды — редактор**: ресурсы (библиотека, картинки, id) живут в проекте редактора,
   Unity их импортирует. Детали экспорта — позже.
5. **Flow-входы множественные.** Or принимает N условий, Choice Was Made отдаёт bool.
6. **MultipleChoice + MultipleChoiceOption заменяются одной нодой реплики со списком выборов**:
   у каждого выбора свой вход условия и свой выход. Подробности — в разделе 6.

## 5. Этапы реализации

1. Загрузка пакета схем, типы портов, схема ноды → автовьюха, формат графа v2, undo для данных. **Готово.**
2. Виджеты полей на ноде (Pixi + DOM-поповеры): int/string/bool/enum, list/record, matrix, nodeRef, динамические порты. **Готово.**
3. Библиотека ресурсов: `library.json`, поля `resource` / `resourceVariant`, превью. **Готово.** Картинки не
   копируются: `root` библиотеки указывает на папку с артом, редактор читает файлы через Rust-команду (только
   внутри корней библиотек) и уменьшает их до 512 px. Библиотека PumpkinQuest генерируется
   `tools/import-unity-resources.mjs` из Unity-проекта с сохранением GUID ассетов.
4. Схемы вьюх.
5. Локализация: JSON на язык, редактирование текста на ноде. **Готово.** Ключ по умолчанию — имя ноды
   (в данных хранится `null`); переименование переносит тексты на новый ключ одним шагом undo, копия ноды
   копирует тексты. Новые Line/Choice получают имя `глава.номер`. Ctrl+S сохраняет граф и изменённые
   файлы языков.
6. Пакет PumpkinQuest: схемы нод (с нодой реплики и выборами), ссылки `itemRef`, валидация графа.
7. Экспорт в Unity: ресурсы и граф — позже.

## 6. Нода реплики с выборами: модель исполнения и сейвы

> **Сейчас в пакете:** выбор временно вынесен в отдельную ноду `dialogue.choice` (текст,
> `isExtraChoice`, вход и выход flow), а Line — простая реплика со входом и выходом `next`. Ссылки на
> выборы — `nodeRef` на ноду Choice. Модель ниже с выборами внутри ноды остаётся в ядре редактора
> (списки с GUID, порты по элементам на строках списка, `itemRef`) на случай, если к ней вернёмся.

### Исходный вариант: выборы внутри ноды

MultipleChoice + MultipleChoiceOption заменяются **одной нодой**, внутри которой лежит список выборов.

### Нода `dialogue.line`

- Поля: `speaker`, `emotion`, `line` (реплика) и `choices` — список выборов. У каждого выбора свой
  **GUID** (как у нод), текст (ключ локализации) и `isExtraChoice`. Все ссылки на выбор — по его GUID.
- Порты:
  - `in` — flow, множественный;
  - на каждый выбор — **вход** `condition:<id>` (bool, необязательный: не подключён — выбор
    доступен всегда) и **выход** `choice:<id>` (flow), подписанный текстом выбора;
  - выход `next` — есть всегда: по нему игра идёт, если выборов нет или ни один нельзя показать
    (все условия ложны).
- Порты адресуются **GUID выбора, а не индексом**. Поэтому перестановка выборов в списке не рвёт связи,
  а удаление одного выбора не сдвигает остальные.

Схема:

```json
{
  "id": "dialogue.line",
  "title": "Line",
  "ports": [
    { "id": "in", "direction": "input", "type": "flow", "capacity": "multiple" },
    { "id": "condition", "direction": "input", "type": "bool", "capacity": "single", "optional": true,
      "repeat": { "list": "choices", "label": "{item.text}" } },
    { "id": "choice", "direction": "output", "type": "flow",
      "repeat": { "list": "choices", "label": "{item.text}" } },
    { "id": "next", "direction": "output", "type": "flow", "label": "Next" }
  ],
  "fields": [
    { "id": "speaker", "type": "resource", "resourceType": "character" },
    { "id": "emotion", "type": "resourceVariant", "source": "speaker", "collection": "emotions" },
    { "id": "line", "type": "localizedText", "keyFrom": "name" },
    { "id": "choices", "type": "list", "item": { "type": "record", "fields": [
      { "id": "text", "type": "localizedText", "keyFrom": "name", "keySuffix": ".{index}" },
      { "id": "isExtraChoice", "type": "bool" }
    ] } }
  ]
}
```

В примитивы редактора это добавляет `repeat` по элементам списка: порт на каждый элемент с ключом
`<портId>:<GUID элемента>`. Элементы списков, у которых на них ссылаются порты или другие ноды,
получают GUID автоматически при создании.

### Исполнение

Ввода ждёт только эта нода; всё остальное выполняется и идёт дальше.
Нода показывает реплику и кнопки — если выборы есть и их можно отрисовать:
- для каждого выбора вычисляется подключённое условие (чистый bool-подграф: `And`, `Or`, `Not`,
  сравнения); выбор с ложным условием не показывается;
- есть хотя бы одна доступная кнопка — показать реплику с кнопками, нажатие ведёт по выходу выбора;
- доступных кнопок нет (список пуст или все условия ложны) — показать реплику, по «дальше» перейти
  по `next`.

### Сейв

Сейв снова хранит **id ноды**. Условия — чистые функции от сохранённого состояния, поэтому при
загрузке они дают тот же набор кнопок. Между репликой и кнопками нет других нод, значит нет и
повторно выполняемых эффектов. Флаг `showsChoices`, пробные проходы и валидация «текст и кнопки на
разных ветках» не нужны.

### Ссылки на выборы

Ссылки, которые ведут на удалённую ноду или элемент, не очищаются: они подсвечиваются как «missing»
и снова находят цель после undo.

`Choice Was Made`, `Choices Were Made`, `Choice Matrix` ссылаются на **GUID выбора**. GUID уникален на
весь граф, поэтому id ноды в ссылке не нужен. Это новый тип поля `itemRef`: ссылка на элемент списка
`choices` в нодах схемы `dialogue.line`. При удалении ноды или выбора ссылка очищается. Выбор в поиске
показывается как «имя ноды → текст выбора».

### Порядок кнопок

Порядок элементов списка на ноде. Перестановка — перетаскиванием в списке, связи сохраняются.

### Что уходит

- `ShowChoice`, `MultipleChoiceOption`, порт типа `choice`.
- Отдельное поле `Condition` у выбора: условие — это порт `condition:<id>`, к которому подключается
  любой bool-подграф.
