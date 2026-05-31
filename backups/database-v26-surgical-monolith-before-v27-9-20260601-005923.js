(()=>{
"use strict";

const V="V27.9";
const JS="assets/js/database-v26-surgical-monolith.js";
const K={my:"epdb26_my",srv:"epdb26_server",mas:"epdb26_masters",mig:"epdb26_migrated",log:"epdb26_log",save:"epdb26_save",clear:"epdb26_clear_meta"};

const SORT_HINTS={"консультация и обследование электромонтажником":{"type":"work","c":"Электромонтажные работы (услуги)","sc":"Работы","g":"Работы","order":0},"один час монтажныx работ без стоимости материалов":{"type":"work","c":"Электромонтажные работы (услуги)","sc":"Работы","g":"Работы","order":1},"один час пуско-наладочныx работ программирование, настройка, сценарии, корректировка":{"type":"work","c":"Электромонтажные работы (услуги)","sc":"Работы","g":"Работы","order":2},"гнезда и ниши для монтажныx коробок":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":3},"изготовление гнезд 72мм для подрозетников в бетонныx стенаx":{"type":"work","c":"Высверливание подрозетников","sc":"Стандарт","g":"Стандарт","order":4},"изготовление гнезд 72мм для подрозетников в кирпичныx и другиx стенаx":{"type":"work","c":"Высверливание подрозетников","sc":"Стандарт","g":"Стандарт","order":5},"изготовление отверстий 68мм для подрозетников в пустотелыx стенаx гкл, гвл,плитаx osb и т.п.":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":6},"устройство ниш под ответвительные распределительные или нестандартные коробки в бетонныx стенаx":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":7},"устройство ниш под ответвительные распределительные или нестандартные коробки в кирпичныx и другиx стенаx":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":8},"устройство ниш под ответвительные распределительные или нестандартные коробки в пустотелыx стенаx гкл, гвл,плитаx osb и т.п.":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":9},"штробы для устройства электропроводки":{"type":"work","c":"Штробление и резка","sc":"Алмазная резка","g":"Алмазная резка","order":10},"устройство борозд штраб до 20x20 мм в бетонныx стенаx":{"type":"work","c":"Штробление и резка","sc":"Алмазная резка","g":"Алмазная резка","order":11},"устройство борозд штраб до 20x20 мм в кирпичныx и другиx стенаx":{"type":"work","c":"Штробление и резка","sc":"Алмазная резка","g":"Алмазная резка","order":12},"проxоды сквозь стены":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":13},"сверление сквозныx отверстий до 32мм в бетонныx стенаx":{"type":"work","c":"Высверливание подрозетников","sc":"Стандарт","g":"Стандарт","order":14},"сверление сквозныx отверстий до 32мм в кирпичныx и другиx стенаx":{"type":"work","c":"Высверливание подрозетников","sc":"Стандарт","g":"Стандарт","order":15},"ниши для щитов":{"type":"work","c":"Щитовое","sc":"Монтаж","g":"Монтаж","order":16},"устройство ниши под под электрический или слаботочный щит в бетонныx стенаx, глубиной до 120 мм":{"type":"work","c":"Щитовое","sc":"Монтаж","g":"Монтаж","order":17},"устройство ниши под электрический или слаботочный щит, в кирпичныx и другиx стенаx глубиной до 120 мм":{"type":"work","c":"Щитовое","sc":"Монтаж","g":"Монтаж","order":18},"устройство ниши под электрический или слаботочный щит, в пустотелыx стенаx гкл, гвл,плитаx osb и т.п.":{"type":"work","c":"Щитовое","sc":"Монтаж","g":"Монтаж","order":19},"светильники":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":20},"изготовление отверстий для точечного светильника в гкл, гвл, до 65 мм":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":21},"изготовление отверстия для точечного светильника в гкл, гвл, более 65 мм":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":22},"изготовление отверстия для точечного светильника в металле толщиной не более 2 мм, до 65 мм":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":23},"изготовление отверстия для точечного светильника в металле толщиной не более 2 мм, более 65 мм":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":24},"слаботочные сети":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":25},"монтаж закладного короба 60x40 для слаботочной сети тв в бетонныx стенаx":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":26},"монтаж закладного короба 60x40 для слаботочной сети тв в кирпичныx и другиx стенаx":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":27},"конструкции из гкл, гвл":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":28},"изготовление конструкции из гкл, гвл для внутреннего монтажа электрического и слаботочного щитов":{"type":"work","c":"Щитовое","sc":"Монтаж","g":"Монтаж","order":29},"устройство ввода":{"type":"work","c":"Подготовительные работы","sc":"Работы","g":"Работы","order":30},"устройство ввода в квартиру от этажного щита":{"type":"work","c":"Щитовое","sc":"Монтаж","g":"Монтаж","order":31},"короб, гофра, труба":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля в гофре / пол","g":"Прокладка кабеля в гофре / пол","order":32},"монтаж кабель-канала пвx, сечение до 20x10 мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":33},"монтаж кабель-канала пвx, сечение до 25x25 мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":34},"монтаж кабель-канала пвx, сечение до 100x60мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":35},"монтаж металлического короба":{"type":"work","c":"Монтаж электропроводки","sc":"Работы","g":"Работы","order":36},"монтаж гофры, трубы пвx, пнд, металлорукава, до 25 мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля в гофре / пол","g":"Прокладка кабеля в гофре / пол","order":37},"монтаж гофры, трубы пвx, пнд, металлорукава, до 50 мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля в гофре / пол","g":"Прокладка кабеля в гофре / пол","order":38},"монтаж лотков металлическиx , шириной до 200 мм":{"type":"work","c":"Монтаж электропроводки","sc":"Работы","g":"Работы","order":39},"монтаж лотков металлическиx , шириной до 400 мм":{"type":"work","c":"Монтаж электропроводки","sc":"Работы","g":"Работы","order":40},"кабель и провод":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":41},"укладка кабеля провода в готовые штрабы, лоток, короб, сечение жил до 4мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":42},"укладка кабеля провода в готовые штрабы, лоток, короб, сечение жил 6мм /10мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":43},"укладка кабеля 4x10, 5x6, 5x10, 3x16 в готовые штрабы, лоток, короб":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":44},"укладка кабеля 4x16, 5x16 в готовые штрабы, лоток, короб":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":45},"затягивание кабеля проводов в трубы пвx, пнд , металлорукав, гофру, при наличии протяжной проволоки":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля в гофре / пол","g":"Прокладка кабеля в гофре / пол","order":46},"затягивание кабеля проводов в трубы пвx, пнд , металлорукав, гофру, без наличия протяжной проволоки":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля в гофре / пол","g":"Прокладка кабеля в гофре / пол","order":47},"затягивание кабеля в пустоты перекрытий":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":48},"прокладка кабеля провода открытым способом, сечение жил до 4мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":49},"прокладка кабеля провода открытым способом, сечением жил 6мм /10мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":50},"прокладка кабеля провода открытым способом, сечение жил 16мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":51},"прокладка кабеля провода открытым способом по потолку, сечение до 4мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля в гофре / пол","g":"Прокладка кабеля в гофре / пол","order":52},"электропроводка":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":53},"наращивание ремонт кабельныx линий, сечение жил до 6 мм2 опрессовка":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":54},"наращивание ремонт кабельныx линий, сечение жил до 16 мм2 опрессовка":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":55},"соединение ремонт силовыx кабелей, сечение жил до 16 мм2 муфта":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":56},"заделка концевая 3-4-5-жильного силового кабеля, сечение одной жилы до 16 мм2":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":57},"оконцевание жил наконечниками, методом опрессовки, сечение жил до 6 мм2":{"type":"work","c":"Монтаж электропроводки","sc":"Работы","g":"Работы","order":58},"оконцевание жил наконечниками, методом опрессовки, сечение жил более 6 мм2":{"type":"work","c":"Монтаж электропроводки","sc":"Работы","g":"Работы","order":59},"сборка щитов":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":60},"комплексная сборка электрического щита":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":61},"монтаж и расключение простого модульного оборудования выкл. нагрузки, автомат, диф, узо на din-рейку":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":62},"монтаж и расключение сложного модульного оборудования реле, контакторы, узип, плк и т.д. на din-рейку":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":63},"монтаж трансформатора, блока питания на din-рейку":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":64},"монтаж электрической розетки на din-рейку":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":65},"монтаж проxодного распределительного блока или колодки до 35мм2 на din-рейку":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":66},"монтаж и расключение распределительного блока кросс-модуля на din-рейку":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":67},"монтаж и расключение одноуровневой клеммы сечением от 4 до 16 мм":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":68},"монтаж и расключение двуx., треxуровневыx клемм сечением до 4 мм":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":69},"монтаж эл.счетчика однофазный, треxфазный":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":70},"установка":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":71},"установка распред. щитка внешнего исполнения , до 60 модулей":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":72},"установка распред. щита внешнего исполнения , больше 60 модулей":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":73},"установка распред. щитка внутреннего исполнения , до 60 модулей, в готовую нишу":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":74},"установка распред. щита внутреннего исполнения , больше 60 модулей, в готовую нишу":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":75},"монтаж оборудования":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":76},"замена и монтаж модульной автоматики диф, узо, автомат, реле и др.":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":77},"подключение":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":78},"присоединение к зажимам жил проводов или кабелей, сечение до 2,5 мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":79},"присоединение к зажимам жил проводов или кабелей, сечение до 6 мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":80},"присоединение к зажимам жил проводов или кабелей, сечение до 16 мм":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":81},"подрозетники":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":82},"монтаж установочныx коробок подрозетников внутренней установки":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":83},"монтаж установочныx коробок подрозетников открытой установки":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":84},"монтаж установочныx коробок подрозетников в пустотелыx стенаx гкл, гвл, osb и т.п.":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":85},"расключение линий в установочныx коробкаx подрозетникаx wago":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":86},"расключение линий в установочныx коробкаx подрозетникаx гильзы":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":87},"розетки, выключатели":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":88},"подключение и монтаж внутренней точки розетка, выключатель, кнопка":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":89},"подключение и монтаж внутренней точки ip44 розетка, выключатель, кнопка":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":90},"подключение и монтаж накладной точки розетка, выключатель, кнопка":{"type":"work","c":"Чистовая установка","sc":"Накладные механизмы","g":"Накладные механизмы","order":91},"монтаж компенсационного кольца 12-24мм при сильно утопленныx подрозетникаx":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":92},"подключение и монтаж розетки для электроплиты":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":93},"подключение и монтаж накладной точки 380 вольт розетка, пром. разъем":{"type":"work","c":"Чистовая установка","sc":"Накладные механизмы","g":"Накладные механизмы","order":94},"распред коробки":{"type":"work","c":"Монтаж электроустановочных изделий","sc":"Работы","g":"Работы","order":95},"монтаж распределительныx коробок внутренней установки":{"type":"work","c":"Монтаж электроустановочных изделий","sc":"Работы","g":"Работы","order":96},"монтаж распределительныx коробок открытой установки":{"type":"work","c":"Монтаж электроустановочных изделий","sc":"Работы","g":"Работы","order":97},"монтаж распределительныx коробок в пустотелыx стенаx гкл, гвл, osb и т.п.":{"type":"work","c":"Монтаж электроустановочных изделий","sc":"Работы","g":"Работы","order":98},"расключение не скрытой распределительной коробки wago не более 8-ми кабелей":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":99},"расключение распределительной коробки опрессовка не более 8-ми кабелей":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":100},"установка и расключение коробки дсуп":{"type":"work","c":"Монтаж электроустановочных изделий","sc":"Работы","g":"Работы","order":101},"временное освещение":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":102},"подключение патрона для временного освещения":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":103},"подключение и монтаж навесныx и настенныx светильников, люстр, бра":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":104},"установка встраиваемыx светильников галогенныx, светодиодныx в готовые отверстия":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":105},"установка подвесного светильника, люстры простая конструкция":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":106},"установка светильника типа бра":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":107},"установка люстры светильника многорожковой, сложной конструкции":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":108},"сборка люстры":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":109},"монтаж трека для освещения шинопровод":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":110},"монтаж трекового светильника":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":111},"монтаж промышленного светильника":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":112},"монтаж офисного светильника армстронг, светодиодная панель":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":113},"монтаж прожектора, уличного светильника":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":114},"подключение и монтаж светодиодныx лент":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":115},"монтаж и подключение понижающего трансформатора, контроллера для освещения":{"type":"work","c":"Освещение","sc":"Светильники","g":"Светильники","order":116},"устройство светодиодной подсветки светодиодная лента без профиля":{"type":"work","c":"Освещение","sc":"LED / профиль","g":"LED / профиль","order":117},"устройство светодиодной подсветки rgb светодиодная лента без профиля":{"type":"work","c":"Освещение","sc":"LED / профиль","g":"LED / профиль","order":118},"монтаж накладного профиля для led подсветки":{"type":"work","c":"Освещение","sc":"LED / профиль","g":"LED / профиль","order":119},"монтаж теплого электрического пола":{"type":"work","c":"Системы обогрева \"тёплый пол\"","sc":"Работы","g":"Работы","order":120},"укладка монтажной ленты при устройстве теплыx полов":{"type":"work","c":"Системы обогрева \"тёплый пол\"","sc":"Работы","g":"Работы","order":121},"укладка нагревательной секции кабеля при устройстве теплыx полов":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля в гофре / пол","g":"Прокладка кабеля в гофре / пол","order":122},"раскладка и раскрой нагревательного мата":{"type":"work","c":"Системы обогрева \"тёплый пол\"","sc":"Работы","g":"Работы","order":123},"монтаж датчиков и терморегуляторов":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":124},"монтаж закладныx трубок для питания и датчика":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":125},"установка датчика температуры":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":126},"установка терморегуляторов термостатов , оборудования для регулятора температуры":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":127},"сборка слаботочного мультимедийного щита":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":128},"сборка мультимедийного щита или слаботочной секции монтажные панели, перегородки, держатели оборудования, патч-панель":{"type":"work","c":"Щитовое","sc":"Сборка щита","g":"Сборка щита","order":129},"монтаж активного или пассивного lan оборудования":{"type":"work","c":"Слаботочные системы","sc":"Работы","g":"Работы","order":130},"монтаж и подключение розеточного блока 220-240v в щите multimedia":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":131},"прокладка и подключение слаботочныx кабелей проводов":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":132},"прокладка слаботочного кабеля utp, tv, knx и т.д.":{"type":"work","c":"Монтаж","sc":"Прокладка кабеля","g":"Прокладка кабеля","order":133},"подключение слаботочной линии utp, tv, knx и т.д. в щите":{"type":"work","c":"Щитовое","sc":"Монтаж","g":"Монтаж","order":134},"монтаж или замена различныx разъемов коннекторов для слаботочныx систем":{"type":"work","c":"Слаботочные системы","sc":"Работы","g":"Работы","order":135},"монтаж оборудования, для слаботочныx информационныx сетей":{"type":"work","c":"Слаботочные системы","sc":"Работы","g":"Работы","order":136},"монтаж внутренней или накладной розетки lan, tv, audio и т.д.":{"type":"work","c":"Чистовая установка","sc":"Накладные механизмы","g":"Накладные механизмы","order":137},"монтаж антенного разветвителя, усилителя, делителя сигнала":{"type":"work","c":"Слаботочные системы","sc":"Работы","g":"Работы","order":138},"монтаж домофонной системы с вызывной видеопанелью":{"type":"work","c":"Слаботочные системы","sc":"Работы","g":"Работы","order":139},"установка и подключение электроприборов":{"type":"work","c":"Подключение электрооборудования и бытовых приборов","sc":"Работы","g":"Работы","order":140},"установка в готовую шаxту и подключение вентилятора":{"type":"work","c":"Подключение электрооборудования и бытовых приборов","sc":"Работы","g":"Работы","order":141},"подключение электроплиты, варочной поверxности, индукционной плиты":{"type":"work","c":"Подключение электрооборудования и бытовых приборов","sc":"Работы","g":"Работы","order":142},"монтаж эл. блока системы от протечки воды, с подключением датчиков и электроприводов":{"type":"work","c":"Чистовая установка","sc":"Механизмы","g":"Механизмы","order":143},"демонтаж":{"type":"work","c":"Демонтаж","sc":"Демонтаж","g":"Демонтаж","order":144}};
const CAT_ORDER={"Электромонтажные работы (услуги)":0,"Подготовительные работы":1,"Высверливание подрозетников":2,"Чистовая установка":3,"Штробление и резка":4,"Щитовое":5,"Освещение":6,"Монтаж":7,"Монтаж электропроводки":8,"Монтаж электроустановочных изделий":9,"Системы обогрева \"тёплый пол\"":10,"Слаботочные системы":11,"Подключение электрооборудования и бытовых приборов":12,"Демонтаж":13};
const SUB_ORDER={"Электромонтажные работы (услуги)\u0001Работы":0,"Подготовительные работы\u0001Работы":1,"Высверливание подрозетников\u0001Стандарт":2,"Чистовая установка\u0001Механизмы":3,"Штробление и резка\u0001Алмазная резка":4,"Щитовое\u0001Монтаж":5,"Освещение\u0001Светильники":6,"Монтаж\u0001Прокладка кабеля в гофре / пол":7,"Монтаж\u0001Прокладка кабеля":8,"Монтаж электропроводки\u0001Работы":9,"Щитовое\u0001Сборка щита":10,"Чистовая установка\u0001Накладные механизмы":11,"Монтаж электроустановочных изделий\u0001Работы":12,"Освещение\u0001LED / профиль":13,"Системы обогрева \"тёплый пол\"\u0001Работы":14,"Слаботочные системы\u0001Работы":15,"Подключение электрооборудования и бытовых приборов\u0001Работы":16,"Демонтаж\u0001Демонтаж":17};

const S={base:"my",type:"work",q:"",edit:false,sel:new Set(),open:new Set(),imp:new Set(),preview:[],master:""};

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const nrm=v=>String(v??"").toLowerCase().replace(/ё/g,"е").replace(/[×хx]/g,"x").replace(/[^a-zа-я0-9x.,\s/_-]/gi," ").replace(/\s+/g," ").trim();
const id=()=> "db26_"+Date.now().toString(36)+"_"+Math.random().toString(16).slice(2);
const rj=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||"")}catch(e){return d}};
const wj=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const money=v=>Math.round(Number(v||0)).toLocaleString("ru-RU")+" ₽";

function email(){try{return firebase?.auth?.().currentUser?.email||""}catch(e){} try{return auth?.currentUser?.email||""}catch(e){} return ""}
function admin(){return String(email()).toLowerCase()==="vits0007@gmail.com"||/(^|\s)admin(\s|$)/i.test(document.body.textContent||"")}
function can(){return S.base==="my"||(S.base==="server"&&admin())}
function role(){return admin()?"Админ":"Мастер"}
function title(){return S.base==="server"?"БД сервера":S.base==="masters"?"БД мастеров":"БД моя"}
function note(){if(S.base==="server")return admin()?"Серверная база: редактирование доступно админу.":"Серверная база: просмотр и копирование в Мою БД."; if(S.base==="masters")return "Просмотр личных баз мастеров. Напрямую не ломаем."; return "Личная база мастера: цены, папки, позиции."}
function log(code,text,x={}){let a=rj(K.log,[]);a.push({time:new Date().toLocaleString("ru-RU"),iso:new Date().toISOString(),code,text,x,file:JS});wj(K.log,a.slice(-150));try{Diagnostics?.ok?.({file:JS,module:"DB26Smart",code,message:text,...x})}catch(e){}}

function hintByName(name){return SORT_HINTS[nrm(name)]||null}
function cleanCategory(v, fallback){let s=String(v??"").trim(); return s||fallback}
function cleanSub(v, fallback){let s=String(v??"").trim(); return s||fallback}

function item(x={},type,baseType){
  let sourceType=type||x.type||x.kind||x.categoryType||"";
  let t=nrm(sourceType).includes("мат")||nrm(sourceType).includes("material")?"material":"work";
  let name=String(x.name||x.title||x.n||x.Наименование||x.naimenovanie||"Позиция").trim();
  let h=hintByName(name)||{};
  if(!sourceType && h.type) t=h.type;
  let defaultCat=t==="work"?"Работы":"Материалы";
  let category=cleanCategory(x.category||x.c||x.cat||x.folder||x.Папка||h.c, defaultCat);
  let subcategory=cleanSub(x.subcategory||x.sc||x.sub||x.g||x.group||x.Подпапка||h.sc||h.g, "Без подкатегории");

  // Если старая миграция уже свалила всё в "Работы / Без подкатегории", но есть подсказка из эталонного JSON — исправляем.
  if(h.c && (category===defaultCat || category==="Работы" || category==="Материалы") && (!subcategory || subcategory==="Без подкатегории")){
    category=h.c;
    subcategory=h.sc||h.g||"Без подкатегории";
  }

  let price=Number(x.price??x.cost??x.p??x.Цена??0)||0;
  let unit=String(x.unit||x.u||x.ed||x.Ед||"шт").trim()||"шт";
  return {
    ...x,
    id:String(x.id||id()),
    type:t,
    baseType:baseType||x.baseType||S.base||"my",
    name,
    n:name,
    category,
    c:category,
    subcategory,
    sc:subcategory,
    g:x.g||subcategory,
    unit,
    u:unit,
    price,
    p:price,
    aliases:Array.isArray(x.aliases)?x.aliases:[],
    source:x.source||"manual",
    active:x.active!==false,
    updatedAt:new Date().toISOString()
  };
}

function seed(){
  return [
    ["work","Штробление","Бетон","Штробление 20x30 бетон","м",550],
    ["work","Штробление","Бетон","Штробление 25x30 бетон","м",600],
    ["work","Высверливание","Глубокие","Высверливание подрозетников глубоких бетон","шт",650],
    ["work","Монтаж","Подрозетники","Монтаж подрозетника","шт",250],
    ["work","Щитовое","Сборка щита","Сборка распределительного щита до 36 модулей","шт",15000],
    ["material","Подрозетники","Глубокие","Подрозетник глубокий 60-75 мм","шт",55],
    ["material","Соединители","ГМЛ","ГМЛ 4","шт",12],
    ["material","Соединители","ГМЛ","ГМЛ 6","шт",16],
    ["material","Расходники","Термоусадка","Термоусадка 12/4","м",80],
    ["material","Соединители","WAGO","WAGO 2-пин","шт",35]
  ].map(([type,category,subcategory,name,unit,price])=>item({type,category,subcategory,name,unit,price},type,"server"))
}

function clearMeta(){let m=rj(K.clear,{});return m&&typeof m==="object"?m:{}}
function writeClearMeta(m){wj(K.clear,m||{})}
function isCleared(b){let m=clearMeta();return !!(m&&m[b]&&m[b].cleared)}
function markCleared(b,reason="manual-clear"){let m=clearMeta();m[b]={cleared:true,clearedAt:new Date().toISOString(),reason,version:V};writeClearMeta(m);log("clear-mark",`Поставлен флаг очистки БД: ${b}`,m[b])}
function unmarkCleared(b){let m=clearMeta();if(m&&m[b]){delete m[b];writeClearMeta(m);log("clear-unmark",`Снят флаг очистки БД: ${b}`)}}
function first(keys){for(const k of keys){let v=rj(k,null);if(Array.isArray(v)&&v.length)return v}return []}
function migrate(){
  if(localStorage.getItem(K.mig)!=="1"){
    let my=first(["ep_db_v24_my","ep_db_v25_my","ep_db_v256_my","electric_pro_my_db"]);
    let srv=first(["ep_db_v24_server","ep_db_v25_server","ep_db_v256_server","electric_pro_server_db"]);
    if(!localStorage.getItem(K.my))wj(K.my,isCleared("my")?[]:my.map(x=>item(x,x.type,"my")));
    if(!localStorage.getItem(K.srv))wj(K.srv,isCleared("server")?[]:(srv.length?srv.map(x=>item(x,x.type,"server")):seed()));
    if(!localStorage.getItem(K.mas))wj(K.mas,{});
    localStorage.setItem(K.mig,"1");
    log("migrate","Миграция V26.4 выполнена");
  }
  autoSortStorage(false);
}

function base(b=S.base){migrateNoSort();if(b==="server")return rj(K.srv,[]);if(b==="masters"){let m=rj(K.mas,{});return S.master?m[S.master]||[]:[]}return rj(K.my,[])}
function migrateNoSort(){if(!localStorage.getItem(K.my))wj(K.my,[]);if(!localStorage.getItem(K.srv))wj(K.srv,isCleared("server")?[]:seed());if(!localStorage.getItem(K.mas))wj(K.mas,{})}
function save(b,rows){
  if(b==="server"&&!admin())return alert("БД сервера редактирует только админ."),false;
  if(b==="masters")return alert("БД мастеров только просмотр/копирование."),false;
  rows=Array.isArray(rows)?rows:[];
  let key=b==="server"?K.srv:K.my;
  let fixed=sortRows(rows.map(x=>item(x,x.type,b)));
  wj(key,fixed);
  if(fixed.length===0)markCleared(b,"local-empty-save");else unmarkCleared(b);
  localStorage.setItem(K.save,new Date().toISOString());
  log("save","БД сохранена локально",{base:b,count:fixed.length,cleared:isCleared(b)});
  try{window.dispatchEvent(new CustomEvent("epdb26:changed",{detail:{base:b,count:fixed.length,cleared:isCleared(b)}}))}catch(e){}
  try{setTimeout(()=>window.DBV266SubBalanceSyncUI?.pushNow?.(),250)}catch(e){}
  return true
}

function catRank(c){return CAT_ORDER[c]??9999}
function subRank(c,s){return SUB_ORDER[c+"\u0001"+s]??9999}
function itemRank(x){let h=hintByName(x.name||x.n);return h?.order??999999}
function sortRows(rows){
  return rows.map(x=>item(x,x.type,x.baseType||S.base)).sort((a,b)=>{
    if(a.type!==b.type)return a.type==="work"?-1:1;
    let ca=catRank(a.category), cb=catRank(b.category); if(ca!==cb)return ca-cb;
    let cn=String(a.category).localeCompare(String(b.category),"ru"); if(ca===9999&&cn)return cn;
    let sa=subRank(a.category,a.subcategory), sb=subRank(b.category,b.subcategory); if(sa!==sb)return sa-sb;
    let sn=String(a.subcategory).localeCompare(String(b.subcategory),"ru"); if(sa===9999&&sn)return sn;
    let ia=itemRank(a), ib=itemRank(b); if(ia!==ib)return ia-ib;
    return String(a.name).localeCompare(String(b.name),"ru");
  });
}
function autoSortStorage(withAlert=true){
  let changed=0;
  [[K.my,"my"],[K.srv,"server"]].forEach(([key,b])=>{
    let old=rj(key,[]);
    if(!Array.isArray(old))old=[];
    let fixed=sortRows(old.map(x=>item(x,x.type,b)));
    let oldSig=JSON.stringify(old.map(x=>[x.id,x.name,x.n,x.category,x.c,x.subcategory,x.sc,x.type,x.price,x.p]));
    let newSig=JSON.stringify(fixed.map(x=>[x.id,x.name,x.n,x.category,x.c,x.subcategory,x.sc,x.type,x.price,x.p]));
    if(oldSig!==newSig){wj(key,fixed);changed+=fixed.length;}
  });
  if(changed)log("autosort","Автосортировка применила структуру категорий",{changed});
  if(withAlert)alert(changed?"Автосортировка применена. Позиции разложены по папкам/подпапкам.":"База уже отсортирована.");
}

function css(){
  if($("#db264-style"))return;
  const st=document.createElement("style"); st.id="db264-style"; st.textContent=`
#ep-db-v26{overflow:auto!important;overscroll-behavior:contain!important;scroll-behavior:auto!important}
#ep-db-v26 .db26h{top:6px!important;transform:none!important;will-change:auto!important}
#ep-db-v26 .db26body,#ep-db-v26 .db26items{display:none!important}
#ep-db-v26 .db26fold.open>.db26body,#ep-db-v26 .db26sub.open>.db26items{display:grid!important;gap:7px!important}
#ep-db-v26 [data-db26-toggle],#ep-db-v26 [data-db26-cat],#ep-db-v26 [data-db26-sub],#ep-db-v26 [data-db26-diag],#ep-db-v26 .db26dot{pointer-events:auto!important;touch-action:manipulation!important}
#ep-db-v26 .db264-version-ghost{display:none!important;visibility:hidden!important}
#ep-db-v26 .db26h p[data-db264-version-line="1"]{opacity:1!important;visibility:visible!important;color:#64748b!important}
[data-db264-route="1"] .db264-hide-extra{display:none!important;visibility:hidden!important}
[data-db264-route="1"] .db264-badge{min-width:64px!important;height:30px!important;display:grid!important;place-items:center!important;border-radius:999px!important;background:rgba(148,163,184,.22)!important;color:#e2e8f0!important;font-style:normal!important;font-size:12px!important;font-weight:950!important;white-space:nowrap!important}
#db26modal.hidden,#db264-overlay.hidden{display:none!important}
#db26modal,#db264-overlay{position:fixed!important;inset:0!important;z-index:2147483700!important;background:rgba(2,6,23,.55)!important;display:grid!important;place-items:end center!important;padding:12px!important}
.db264-panel{width:min(960px,100%)!important;max-height:88vh!important;overflow:auto!important;border-radius:24px!important;background:#f8fafc!important;color:#0f172a!important;padding:14px!important;box-shadow:0 24px 70px rgba(0,0,0,.36)!important;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
.db264-head{display:grid!important;grid-template-columns:1fr auto!important;gap:8px!important;align-items:center!important;margin-bottom:10px!important}
.db264-head h3{margin:0!important;font-size:18px!important;font-weight:950!important;color:#0f172a!important}
.db264-head button{width:40px!important;height:40px!important;border:0!important;border-radius:999px!important;background:rgba(239,68,68,.12)!important;color:#991b1b!important;font-size:22px!important;font-weight:950!important}
.db264-grid{display:grid!important;gap:8px!important}
.db264-grid label{display:grid!important;gap:4px!important;color:#64748b!important;font-size:12px!important;font-weight:900!important}
.db264-grid input,.db264-grid select,.db264-grid textarea{width:100%!important;min-height:44px!important;border:1px solid rgba(15,23,42,.12)!important;border-radius:14px!important;background:#fff!important;color:#0f172a!important;padding:8px 10px!important;font-size:15px!important;font-weight:800!important}
.db264-actions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;margin-top:10px!important}
.db264-actions button,.db264-actions label{min-height:46px!important;border:1px solid rgba(15,23,42,.08)!important;border-radius:16px!important;background:#eef2f7!important;color:#475569!important;font-size:14px!important;font-weight:950!important;display:grid!important;place-items:center!important;text-align:center!important}
.db264-actions .green{background:linear-gradient(135deg,rgba(34,197,94,.24),rgba(20,184,166,.18))!important;color:#064e3b!important;border-color:rgba(34,197,94,.42)!important}
.db264-actions .red{background:rgba(239,68,68,.12)!important;color:#991b1b!important}
.db264-text{width:100%!important;min-height:260px!important;border:1px solid rgba(15,23,42,.12)!important;border-radius:14px!important;padding:10px!important;background:#fff!important;color:#0f172a!important;font-family:monospace!important;font-size:12px!important;white-space:pre!important}
.db264-preview{display:grid!important;gap:6px!important;margin:10px 0!important;max-height:42vh!important;overflow:auto!important}
.db264-preview div{padding:8px 10px!important;border-radius:12px!important;background:#fff!important;border:1px solid rgba(15,23,42,.08)!important}
.db264-ai-note{padding:10px!important;border-radius:14px!important;background:#fff7ed!important;color:#9a3412!important;font-weight:850!important;line-height:1.35!important}
@media(max-width:720px){.db264-actions{grid-template-columns:1fr!important}}
`;
  document.head.appendChild(st);
}

function el(){
  let e=$("#ep-db-v26");
  if(!e){e=document.createElement("div");e.id="ep-db-v26";e.className="hidden";document.body.appendChild(e)}
  return e;
}
function hideOld(){$$("#ep-db-v25-screen,#ep-db-v256-screen,#ep-db-v244-screen,#ep-db-v243-screen,#ep-db-v24-screen,#ep-database-screen,[data-screen='database']").forEach(x=>{if(x.id!=="ep-db-v26"){x.classList.add("hidden");x.style.setProperty("display","none","important")}})}

function rows(){
  let q=nrm(S.q);
  return base(S.base).filter(x=>x&&x.active!==false&&x.type===S.type).filter(x=>!q||nrm([x.name,x.category,x.subcategory,x.unit,x.price].join(" ")).includes(q));
}
function group(a){
  let m=new Map();
  a.forEach(x=>{let c=x.category||"Без категории",s=x.subcategory||"Без подкатегории";if(!m.has(c))m.set(c,new Map());if(!m.get(c).has(s))m.get(c).set(s,[]);m.get(c).get(s).push(x)});
  return [...m].map(([c,ss])=>({c,ss:[...ss].map(([s,it])=>({s,it:sortRows(it)})).sort((a,b)=>(subRank(c,a.s)-subRank(c,b.s))||a.s.localeCompare(b.s,"ru"))})).sort((a,b)=>(catRank(a.c)-catRank(b.c))||a.c.localeCompare(b.c,"ru"));
}

function render(){
  css(); hideOld(); autoSortStorage(false);
  let rs=rows(),e=el();
  e.innerHTML=`
<div class="db26h"><button data-db26-close>←</button><div><h2>База данных</h2><p data-db264-version-line="1">${role()} · ${V}</p></div><b class="db26pill">${esc(title())}</b><button class="db26dot" data-db26-diag></button></div>
<div class="db26status">✅ Локально: готово · импорт JSON/текст внутри, фото/PDF/Excel через ИИ/парсер по подтверждению</div>
<main class="db26shell">
<section class="db26card"><div class="db26switch"><button data-db26-base="server" class="${S.base==="server"?"on":""}">БД сервера</button><button data-db26-base="my" class="${S.base==="my"?"on":""}">БД моя</button>${admin()?`<button data-db26-base="masters" class="${S.base==="masters"?"on":""}">БД мастеров</button>`:""}</div><p>${esc(note())}</p></section>
<section class="db26card"><button class="db26et" data-db26-editor><span>${S.edit?"▾":"▸"}</span><b>Редактор БД</b><em>${S.edit?"открыт":"свернут"}</em></button>${S.edit?editor():""}</section>
<section class="db26card"><div class="db26tabs"><button data-db26-type="work" class="${S.type==="work"?"on":""}">Работа</button><button data-db26-type="material" class="${S.type==="material"?"on":""}">Материал</button></div><input class="db26search" data-db26-search placeholder="Поиск..." value="${esc(S.q)}"><div class="db26lh"><h3>${S.type==="work"?"Работы":"Материалы"}</h3><span>${rs.length} поз. · ${can()?"редактирование доступно":"только просмотр"}</span><button data-db26-toggle>${S.open.size?"Свернуть":"Развернуть"}</button></div><div class="db26tree">${tree(rs)}</div></section>
<section class="db26card"><h3>Экспорт / импорт</h3><p>JSON и текст импортируются внутри приложения. Фото/PDF/Excel — через ИИ/парсер только после предупреждения.</p><div class="db26act db264-actions"><button data-db26-export>Экспорт JSON</button><label class="db26file">Импорт файла<input type="file" data-db26-import accept=".json,.txt,.csv,.xlsx,.xls,.pdf,image/*"></label><button data-db264-autosort>Автосортировка</button></div></section>
<section class="db26card"><h3>Склад</h3><p>Склад подключим следующим отдельным модулем после финальной стабилизации БД.</p></section>
</main><div id="db26modal" class="hidden"></div>`;
  applyOpenState();
}

function editor(){
  return `<div class="db26edit">
${S.base==="my"?`<h4>Импорт из БД сервера</h4><p>Открывается отдельным окном. Можно добавить с ценой или без.</p><div class="db26act"><button data-db26-openimport>Открыть импорт</button><button data-db26-copysrv>Добавить выбранное с сервера</button></div>`:""}
<h4>Управление выбранной БД</h4><div class="db26act">
${can()?`<button data-db26-add>Добавить позицию</button><button data-db26-move>Переместить</button><button data-db26-del>Удалить</button><button data-db26-hardclear>Очистить всю БД</button>`:""}
<button data-db26-selall>Выделить всё</button><button data-db26-clear>Снять выделение</button><button data-db264-autosort>Автосортировка</button>
</div></div>`;
}

function tree(a){
  let g=group(a); if(!g.length)return `<div class="db26empty">Позиции не найдены.</div>`;
  return g.map(c=>{let ck=S.base+"|"+S.type+"|"+c.c,op=S.open.has(ck),ids=c.ss.flatMap(s=>s.it.map(x=>x.id)),ch=ids.length&&ids.every(i=>S.sel.has(i));return `<div class="db26fold ${op?"open":""}"><div class="db26chk"><label><input type="checkbox" data-db26-catcheck="${esc(ck)}" ${ch?"checked":""}></label><button class="db26fh" data-db26-cat="${esc(ck)}"><span>${op?"📂":"📁"}</span><b>${esc(c.c)}</b><em>${ids.length}</em></button></div><div class="db26body">${c.ss.map(s=>sub(ck,s)).join("")}</div></div>`}).join("");
}
function sub(ck,s){let sk=ck+"|"+s.s,op=S.open.has(sk),ids=s.it.map(x=>x.id),ch=ids.length&&ids.every(i=>S.sel.has(i));return `<div class="db26sub ${op?"open":""}"><div class="db26chk"><label><input type="checkbox" data-db26-subcheck="${esc(sk)}" ${ch?"checked":""}></label><button class="db26sh" data-db26-sub="${esc(sk)}"><span>${op?"▾":"▸"}</span><b>${esc(s.s)}</b><em>${ids.length}</em></button></div><div class="db26items">${s.it.map(it).join("")}</div></div>`}
function it(x){let ch=S.sel.has(x.id);return `<div class="db26it ${ch?"sel":""}"><label><input type="checkbox" data-db26-check="${esc(x.id)}" ${ch?"checked":""}></label><button class="db26im" data-db26-card="${esc(x.id)}"><b>${esc(x.name)}</b><p>${money(x.price)} / ${esc(x.unit)} · ${x.type==="work"?"Работа":"Материал"}</p></button></div>`}

function updateFolderIcon(fold){let sp=fold?.querySelector("[data-db26-cat] span,.db26fh span");if(sp)sp.textContent=fold.classList.contains("open")?"📂":"📁"}
function updateSubIcon(sub){let sp=sub?.querySelector("[data-db26-sub] span,.db26sh span");if(sp)sp.textContent=sub.classList.contains("open")?"▾":"▸"}
function setOpenDom(node,on){if(!node)return;node.classList.toggle("open",!!on);if(node.classList.contains("db26fold"))updateFolderIcon(node);if(node.classList.contains("db26sub"))updateSubIcon(node)}
function keyFor(btn){return btn?.getAttribute("data-db26-cat")||btn?.getAttribute("data-db26-sub")||""}
function applyOpenState(){let r=el();$$("[data-db26-cat]",r).forEach(b=>setOpenDom(b.closest(".db26fold"),S.open.has(keyFor(b))));$$("[data-db26-sub]",r).forEach(b=>setOpenDom(b.closest(".db26sub"),S.open.has(keyFor(b))));updateToggleText()}
function updateToggleText(){let btn=$("[data-db26-toggle]",el());if(!btn)return;let folds=$$(".db26fold",el());btn.textContent=folds.length&&folds.every(f=>f.classList.contains("open"))?"Свернуть":"Развернуть"}
function toggleFold(btn){let k=keyFor(btn),f=btn.closest(".db26fold"),on=!f.classList.contains("open");on?S.open.add(k):S.open.delete(k);setOpenDom(f,on);updateToggleText()}
function toggleSub(btn){let k=keyFor(btn),s=btn.closest(".db26sub"),on=!s.classList.contains("open");on?S.open.add(k):S.open.delete(k);setOpenDom(s,on);updateToggleText()}
function toggleAll(){let folds=$$(".db26fold",el()),open=folds.some(f=>!f.classList.contains("open"));folds.forEach(f=>{let b=$("[data-db26-cat]",f),k=keyFor(b);open?S.open.add(k):S.open.delete(k);setOpenDom(f,open)});$$(".db26sub",el()).forEach(s=>{let b=$("[data-db26-sub]",s),k=keyFor(b);open?S.open.add(k):S.open.delete(k);setOpenDom(s,open)});updateToggleText()}

function byId(i){return base(S.base).find(x=>x.id===i)}
function openModal(html){let m=$("#db26modal");if(!m){m=document.createElement("div");m.id="db26modal";document.body.appendChild(m)}m.className="";m.innerHTML=html}
function closeModal(){$("#db26modal")?.classList.add("hidden")}
function card(i){let x=byId(i);if(!x)return;openModal(`<div class="db264-panel"><div class="db264-head"><h3>Карточка позиции</h3><button data-db26-closemodal>×</button></div>
<div class="db264-grid">
<label>Название<input data-db264-edit="name" value="${esc(x.name)}"></label>
<label>Цена<input data-db264-edit="price" type="number" step="0.01" value="${esc(x.price)}"></label>
<label>Единица<input data-db264-edit="unit" value="${esc(x.unit)}"></label>
<label>Папка / категория<input data-db264-edit="category" value="${esc(x.category)}"></label>
<label>Подпапка<input data-db264-edit="subcategory" value="${esc(x.subcategory)}"></label>
<label>Тип<select data-db264-edit="type"><option value="work" ${x.type==="work"?"selected":""}>Работа</option><option value="material" ${x.type==="material"?"selected":""}>Материал</option></select></label>
</div>
<div class="db264-actions"><button class="green" data-db264-save-card="${esc(x.id)}">Сохранить</button><button data-db26-closemodal>Закрыть</button></div></div>`)}
function saveCard(i){if(!can())return alert("Эту БД нельзя редактировать.");let a=base(S.base),x=a.find(y=>y.id===i);if(!x)return;let m=$("#db26modal");["name","price","unit","category","subcategory","type"].forEach(k=>{let inp=$(`[data-db264-edit="${k}"]`,m);if(!inp)return;let v=inp.value;if(k==="price")v=Number(v||0);x[k]=v;});x.n=x.name;x.p=x.price;x.u=x.unit;x.c=x.category;x.sc=x.subcategory;x.g=x.subcategory;x.updatedAt=new Date().toISOString();save(S.base,a);closeModal();render()}

function add(){if(!can())return;let x=item({name:"Новая позиция",price:0,unit:"шт",category:S.type==="work"?"Работы":"Материалы",subcategory:"Без подкатегории",type:S.type},S.type,S.base);let a=base(S.base);a.push(x);save(S.base,a);render();setTimeout(()=>card(x.id),80)}
function del(){if(!can())return alert("Эту БД нельзя редактировать.");if(!S.sel.size)return alert("Ничего не выбрано.");if(confirm("Удалить выбранные позиции: "+S.sel.size+"?")){save(S.base,base(S.base).filter(x=>!S.sel.has(x.id)));S.sel.clear();render()}}
function hardClearBase(){
  if(!can())return alert("Эту БД нельзя редактировать.");
  let label=S.base==="server"?"БД сервера":"Мою БД";
  if(!confirm("Полностью очистить "+label+"? После синхронизации она останется пустой и после перезагрузки."))return;
  save(S.base,[]);
  S.sel.clear();
  S.open.clear();
  alert(label+" очищена. Дождись статуса Firebase: выгружена 0 / подключено.");
  render();
}
function move(){if(!can())return alert("Эту БД нельзя редактировать.");if(!S.sel.size)return alert("Ничего не выбрано.");let c=prompt("Новая папка","");if(!c)return;let s=prompt("Новая подпапка","Без подкатегории")||"Без подкатегории",a=base(S.base);a.forEach(x=>{if(S.sel.has(x.id)){x.category=c;x.c=c;x.subcategory=s;x.sc=s;x.g=s}});save(S.base,a);render()}

function exp(){let a=sortRows(base(S.base));let payload={version:V,source:S.base,exportedAt:new Date().toISOString(),workDB:a.filter(x=>x.type==="work").map(shortItem),matDB:a.filter(x=>x.type==="material").map(shortItem)};let b=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),l=document.createElement("a");l.href=URL.createObjectURL(b);l.download="electric-pro-db-v26-4-"+S.base+".json";document.body.appendChild(l);l.click();setTimeout(()=>{URL.revokeObjectURL(l.href);l.remove()},500)}
function shortItem(x){return {id:x.id,n:x.name,p:x.price,u:x.unit,c:x.category,sc:x.subcategory,g:x.g||x.subcategory,type:x.type,source:x.source||"manual"}}

function parseJsonData(data,typeHint){let out=[];if(Array.isArray(data))data.forEach(x=>out.push(item(x,x.type||typeHint,S.base)));if(Array.isArray(data.workDB))data.workDB.forEach(x=>out.push(item(x,"work",S.base)));if(Array.isArray(data.matDB))data.matDB.forEach(x=>out.push(item(x,"material",S.base)));if(Array.isArray(data.items))data.items.forEach(x=>out.push(item(x,x.type||typeHint,S.base)));return sortRows(out)}
function parseText(txt){return sortRows(String(txt||"").split(/\r?\n/).filter(Boolean).map(line=>{let p=line.split(/[;\t,]/).map(s=>s.trim());return item({name:p[0],category:p[1]||"Импорт",subcategory:p[2]||"Без подкатегории",unit:p[3]||"шт",price:p[4]||0,type:S.type},S.type,S.base)}))}
function duplicateInfo(rows){let a=base(S.base),add=0,dup=0;rows.forEach(x=>{let sig=nrm(x.type+"|"+x.name+"|"+x.unit);a.some(y=>nrm(y.type+"|"+y.name+"|"+y.unit)===sig)?dup++:add++});return {add,dup}}
function previewImport(rows,src){S.preview=rows;if(!rows.length)return alert("Позиции не найдены.");let info=duplicateInfo(rows),w=rows.filter(x=>x.type==="work").length,m=rows.filter(x=>x.type==="material").length;openModal(`<div class="db264-panel"><div class="db264-head"><h3>Предпросмотр импорта</h3><button data-db26-closemodal>×</button></div>
<p><b>Источник:</b> ${esc(src)}<br><b>Найдено:</b> ${rows.length} поз. · работы ${w} · материалы ${m}<br><b>Новые:</b> ${info.add} · <b>дубли:</b> ${info.dup}</p>
<div class="db264-preview">${rows.slice(0,30).map(x=>`<div><b>${esc(x.name)}</b><br>${money(x.price)} / ${esc(x.unit)} · ${esc(x.category)} / ${esc(x.subcategory)} · ${x.type==="work"?"Работа":"Материал"}</div>`).join("")}${rows.length>30?`<div>… ещё ${rows.length-30} поз.</div>`:""}</div>
<div class="db264-actions"><button class="green" data-db264-import-apply="with">Добавить с ценами</button><button data-db264-import-apply="noprice">Добавить без цен</button><button class="red" data-db264-import-apply="replace">Заменить выбранную БД</button><button data-db26-closemodal>Отмена</button></div></div>`)}
function applyImport(mode){if(!can())return alert("Импорт в эту БД запрещён.");let rows=S.preview||[];if(!rows.length)return;let a=mode==="replace"?[]:base(S.base),add=0,dup=0;rows.forEach(x=>{let y=item({...x,price:mode==="noprice"?0:x.price,p:mode==="noprice"?0:x.price,id:mode==="replace"?x.id:undefined,source:"import_v26_4"},x.type,S.base);let sig=nrm(y.type+"|"+y.name+"|"+y.unit);if(mode!=="replace"&&a.some(z=>nrm(z.type+"|"+z.name+"|"+z.unit)===sig)){dup++;return}a.push(y);add++;});save(S.base,a);S.preview=[];closeModal();render();alert("Импорт завершён. Добавлено: "+add+". Дубли: "+dup+".")}
function aiNotice(file,kind){openModal(`<div class="db264-panel"><div class="db264-head"><h3>Нужен ИИ / парсер</h3><button data-db26-closemodal>×</button></div><div class="db264-ai-note">Файл «${esc(file.name)}» похож на ${esc(kind)}. Для такого импорта нужно распознавание: фото/PDF через ИИ/OCR, Excel через XLSX-парсер. Сейчас файл никуда не отправлялся. На следующем шаге подключим обработчик и будем отдельно предупреждать, когда используется ИИ и расходуются токены.</div><div class="db264-actions"><button data-db26-closemodal>Понятно</button></div></div>`)}
function excelRowsToItems(aoa){if(!Array.isArray(aoa)||!aoa.length)return[];var nz=function(v){return String(v==null?"":v).toLowerCase().replace(/\u0451/g,"\u0435").replace(/\s+/g," ").trim()};var rows=aoa.map(function(r){return Array.isArray(r)?r:[r]});var head=rows[0].map(nz);var hasHeader=head.some(function(h){return /\u043d\u0430\u0438\u043c\u0435\u043d|\u043d\u0430\u0437\u0432\u0430\u043d|name|\u0442\u043e\u0432\u0430\u0440|\u0443\u0441\u043b\u0443\u0433|\u0440\u0430\u0431\u043e\u0442|\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b|\u0446\u0435\u043d\u0430|\u0441\u0442\u043e\u0438\u043c|price|\u0435\u0434|unit|\u0438\u0437\u043c|\u043f\u0430\u043f\u043a|\u043a\u0430\u0442\u0435\u0433\u043e\u0440|group|\u0433\u0440\u0443\u043f\u043f/.test(h)});var map={name:0,category:1,subcategory:2,unit:3,price:4},start=0;if(hasHeader){start=1;var find=function(){var keys=[].slice.call(arguments);return head.findIndex(function(h){return keys.some(function(k){return h.indexOf(k)>=0})})};var iName=find("\u043d\u0430\u0438\u043c\u0435\u043d","\u043d\u0430\u0437\u0432\u0430\u043d","name","\u0442\u043e\u0432\u0430\u0440","\u043f\u043e\u0437\u0438\u0446","\u0440\u0430\u0431\u043e\u0442","\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b");var iCat=find("\u043f\u0430\u043f\u043a","\u043a\u0430\u0442\u0435\u0433\u043e\u0440","\u0440\u0430\u0437\u0434\u0435\u043b","group","\u0433\u0440\u0443\u043f\u043f");var iSub=find("\u043f\u043e\u0434\u043f\u0430\u043f\u043a","\u043f\u043e\u0434\u043a\u0430\u0442\u0435\u0433","\u043f\u043e\u0434\u0440\u0430\u0437\u0434\u0435\u043b","subgroup");var iUnit=find("\u0435\u0434","unit","\u0438\u0437\u043c");var iPrice=find("\u0446\u0435\u043d\u0430","\u0441\u0442\u043e\u0438\u043c","price","\u0440\u0443\u0431");map={name:iName>=0?iName:0,category:iCat>=0?iCat:1,subcategory:iSub>=0?iSub:2,unit:iUnit>=0?iUnit:3,price:iPrice>=0?iPrice:4}}var out=[];for(var i=start;i<rows.length;i++){var r=rows[i];var nm=String(r[map.name]==null?"":r[map.name]).trim();if(!nm)continue;out.push(item({name:nm,category:String(r[map.category]==null?"":r[map.category]).trim()||"\u0418\u043c\u043f\u043e\u0440\u0442",subcategory:String(r[map.subcategory]==null?"":r[map.subcategory]).trim()||"\u0411\u0435\u0437 \u043f\u043e\u0434\u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438",unit:String(r[map.unit]==null?"":r[map.unit]).trim()||"\u0448\u0442",price:r[map.price]==null?0:r[map.price],type:S.type},S.type,S.base))}return sortRows(out)}function imp(file){if(!file)return;if(!can())return alert("Импорт в эту БД запрещён.");let name=file.name.toLowerCase(),type=file.type||"";if(type.startsWith("image/"))return aiNotice(file,"изображение");if(name.endsWith(".pdf"))return aiNotice(file,"PDF");if(/\.xlsx?$/.test(name)){if(typeof XLSX==="undefined")return aiNotice(file,"Excel");var rb=new FileReader();rb.onload=function(){try{var wb=XLSX.read(new Uint8Array(rb.result),{type:"array"});var ws=wb.Sheets[wb.SheetNames[0]];var aoa=XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false,defval:""});var arr=excelRowsToItems(aoa);previewImport(arr,file.name)}catch(e){alert("\u041e\u0448\u0438\u0431\u043a\u0430 \u0447\u0442\u0435\u043d\u0438\u044f Excel: "+(e.message||e))}};rb.readAsArrayBuffer(file);return}let rd=new FileReader();rd.onload=()=>{try{let txt=String(rd.result||""),arr=name.endsWith(".json")?parseJsonData(JSON.parse(txt),S.type):parseText(txt);previewImport(arr,file.name)}catch(e){alert("Ошибка импорта: "+(e.message||e))}};rd.readAsText(file)}

function diagPayload(){
  const myRows = base("my");
  const serverRows = base("server");
  const rawLog = rj(K.log, []);
  const safeLog = (Array.isArray(rawLog) ? rawLog : []).slice(-35).map((x, idx) => {
    const extra = x && typeof x.extra === "object" && x.extra ? x.extra : null;
    return {
      n: idx + 1,
      time: String(x?.time || x?.iso || "").slice(0, 40),
      code: String(x?.code || "").slice(0, 80),
      text: String(x?.text || x?.message || "").slice(0, 220),
      file: String(x?.file || "").slice(0, 80),
      extraKeys: extra ? Object.keys(extra).slice(0, 10) : []
    };
  });

  let localStorageBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      localStorageBytes += String(k || "").length + String(localStorage.getItem(k) || "").length;
    }
  } catch(e) {}

  return {
    version: V,
    time: new Date().toISOString(),
    base: S.base,
    type: S.type,
    counts: {
      my: myRows.length,
      server: serverRows.length,
      visible: rows().length,
      selected: S.sel.size
    },
    storage: {
      approxBytes: localStorageBytes,
      myBytes: String(localStorage.getItem(K.my) || "").length,
      serverBytes: String(localStorage.getItem(K.srv) || "").length,
      logCount: Array.isArray(rawLog) ? rawLog.length : 0
    },
    scripts: Array.from(document.scripts)
      .map(s => String(s.src || ""))
      .filter(s => s.includes("database-v26") || s.includes("db-v26"))
      .map(s => s.split("/").slice(-2).join("/"))
      .slice(-30),
    logLast: safeLog,
    note: "Диагностика облегчена: большие массивы БД и полные extra-логи не выводятся, чтобы телефон не зависал."
  };
}

function diagPayload(){
  const myRows = base("my");
  const serverRows = base("server");
  const rawLog = rj(K.log, []);
  const safeLog = (Array.isArray(rawLog) ? rawLog : []).slice(-35).map((x, idx) => {
    const extra = x && typeof x.extra === "object" && x.extra ? x.extra : null;
    return {
      n: idx + 1,
      time: String(x?.time || x?.iso || "").slice(0, 40),
      code: String(x?.code || "").slice(0, 80),
      text: String(x?.text || x?.message || "").slice(0, 220),
      file: String(x?.file || "").slice(0, 80),
      extraKeys: extra ? Object.keys(extra).slice(0, 10) : []
    };
  });

  let localStorageBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      localStorageBytes += String(k || "").length + String(localStorage.getItem(k) || "").length;
    }
  } catch(e) {}

  return {
    version: V,
    time: new Date().toISOString(),
    base: S.base,
    type: S.type,
    counts: {
      my: myRows.length,
      server: serverRows.length,
      visible: rows().length,
      selected: S.sel.size
    },
    storage: {
      approxBytes: localStorageBytes,
      myBytes: String(localStorage.getItem(K.my) || "").length,
      serverBytes: String(localStorage.getItem(K.srv) || "").length,
      logCount: Array.isArray(rawLog) ? rawLog.length : 0
    },
    scripts: Array.from(document.scripts)
      .map(s => String(s.src || ""))
      .filter(s => s.includes("database-v26") || s.includes("db-v26"))
      .map(s => s.split("/").slice(-2).join("/"))
      .slice(-30),
    logLast: safeLog,
    note: "Диагностика облегчена: большие массивы БД и полные extra-логи не выводятся, чтобы телефон не зависал."
  };
}

function diag(){
  let txt;
  try {
    txt = JSON.stringify(diagPayload(), null, 2);
  } catch(e) {
    txt = JSON.stringify({version: V, time: new Date().toISOString(), error: String(e?.message || e)}, null, 2);
  }

  openModal(`<div class="db264-panel"><div class="db264-head"><h3>Диагностика БД</h3><button data-db26-closemodal>×</button></div><textarea class="db264-text" readonly>${esc(txt)}</textarea><div class="db264-actions"><button data-db264-copy-diag>Копировать</button><button data-db264-clear-diag>Очистить логи</button></div></div>`);
}
function copyDiag(){
  let txt = $(".db264-text")?.value || "";
  if (!txt) {
    try { txt = JSON.stringify(diagPayload(), null, 2); } catch(e) { txt = String(e?.message || e); }
  }
  navigator.clipboard?.writeText ? navigator.clipboard.writeText(txt).then(()=>alert("Диагностика скопирована.")) : alert(txt);
}

function importModal(){let old=S.base;S.base="server";let html=tree(base("server").filter(x=>x.type===S.type));S.base=old;openModal(`<div class="db264-panel"><div class="db264-head"><h3>Импорт из БД сервера</h3><button data-db26-closemodal>×</button></div><p>Открой БД сервера, выбери позиции галочками и добавь в Мою БД.</p><div class="db264-actions"><button data-db264-srvview>Открыть БД сервера</button><button data-db26-copysrv>Добавить выбранное в мою БД</button></div></div>`)}
function copySrv(){let srv=base("server"),my=base("my"),sel=srv.filter(x=>S.sel.has(x.id));if(!sel.length)return alert("Сначала выбери позиции в БД сервера.");let a=0,d=0;sel.forEach(x=>{let sig=nrm(x.type+"|"+x.name+"|"+x.unit);if(my.some(y=>nrm(y.type+"|"+y.name+"|"+y.unit)===sig))d++;else{my.push(item({...x,id:undefined,source:"server_copy"},x.type,"my"));a++}});save("my",my);S.base="my";S.sel.clear();alert("Добавлено: "+a+". Дубли: "+d);render()}

function open(){migrate();S.base=localStorage.getItem("epdb26_active_base")==="server"?"server":"my";S.type="work";S.q="";S.sel.clear();S.open.clear();render();el().classList.remove("hidden");log("open","БД V26.4 открыта")}
function close(){el().classList.add("hidden")}

function externalDbTrigger(x){if(!x||x.closest?.("#ep-db-v26,#db26modal,.ep2615-picker,.ep27-picker,.ep27-picker"))return false;if(x.closest?.("[data-ep2615-main-picker],[data-ep2616-main-picker],[data-ep27-db-picker],[data-ep27-pick],.ep2615-estimate-card,.ep27-estimate-card"))return false;let t=nrm(x.textContent),a=[x.id,x.className,x.getAttribute?.("data-route"),x.getAttribute?.("data-screen"),x.getAttribute?.("data-ep-shell-route"),x.getAttribute?.("onclick"),x.getAttribute?.("href"),x.getAttribute?.("aria-label")].filter(Boolean).join(" ").toLowerCase();return a.includes("database")||(t.includes("база данных")&&t.length<180)}
function findExternal(e){let p=e.composedPath?e.composedPath():[];for(const n of p){if(!(n instanceof Element))continue;if(n===document.body||n===document.documentElement)break;if(externalDbTrigger(n))return n}return null}
function fixBurgerBadge(){$$("button,a,li,div,[role='button']").forEach(row=>{if(row.closest("#ep-db-v26,#db26modal"))return;let t=nrm(row.textContent),r=row.getBoundingClientRect();if(!t.includes("база данных")||t.length>180||r.height>170)return;row.setAttribute("data-db264-route","1");let badges=$$("span,em,b,strong,small,i,div",row).filter(b=>{let tx=String(b.textContent||"").trim(),cl=String(b.className||"").toLowerCase();return (/^v\d+(\.\d+){0,3}$/i.test(tx)||cl.includes("version")||cl.includes("badge"))&&!/база данных/i.test(tx)});if(!badges.length){let b=document.createElement("span");row.appendChild(b);badges=[b]}badges.forEach((b,i)=>{if(i===0){b.textContent=V;b.classList.add("db264-badge");b.classList.remove("db264-hide-extra");b.style.removeProperty("display");b.style.removeProperty("visibility")}else{b.classList.add("db264-hide-extra");b.style.setProperty("display","none","important")}})})}
function patchRouterObject(obj,name){if(!obj||typeof obj[name]!=="function"||obj[name].__db264Patched)return;let old=obj[name];let w=function(...args){let r=nrm(args[0]);if(r==="database"||r==="db"||r.includes("database")||r.includes("база")){open();return true}return old.apply(this,args)};w.__db264Patched=true;w.__db264Original=old;try{obj[name]=w}catch(e){}}
function patchRouters(){patchRouterObject(window.Router,"load");patchRouterObject(window.Router,"navigate");patchRouterObject(window.AppRouter,"load");patchRouterObject(window.AppRouter,"navigate");patchRouterObject(window,"navigateTo");patchRouterObject(window,"showScreen")}

function click(e){
  css();
  if(e.target.closest?.("#db26modal")){
    if(e.target.closest("[data-db26-closemodal]")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();closeModal();return}
    if(e.target.closest("[data-db264-save-card]")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();saveCard(e.target.closest("[data-db264-save-card]").dataset.db264SaveCard);return}
    let ap=e.target.closest("[data-db264-import-apply]"); if(ap){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();applyImport(ap.dataset.db264ImportApply);return}
    if(e.target.closest("[data-db264-copy-diag]")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();copyDiag();return}
    if(e.target.closest("[data-db264-clear-diag]")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();wj(K.log,[]);diag();return}
    if(e.target.closest("[data-db264-srvview]")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();closeModal();S.base="server";render();return}
  }

  let ext=findExternal(e); if(ext){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();open();return}
  if(!e.target.closest?.("#ep-db-v26"))return;

  if(e.target.closest("[data-db26-close]"))return e.preventDefault(),close();
  if(e.target.closest("[data-db26-diag],.db26dot")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();diag();return}
  let b=e.target.closest("[data-db26-base]"); if(b){e.preventDefault();S.base=b.dataset.db26Base;let __activeBase=S.base==="server"?"server":"my";localStorage.setItem("epdb26_active_base",__activeBase);localStorage.setItem("epdb27_active_base",__activeBase);try{localStorage.setItem("epdb27_active_base_meta",JSON.stringify({base:__activeBase,source:"db26-click",version:"V27.3",updatedAt:new Date().toISOString(),time:Date.now()}));window.EPDatabaseV27?.setActiveBase?.(__activeBase,"db26-click");}catch(_e){}S.sel.clear();S.open.clear();render();return}
  let t=e.target.closest("[data-db26-type]"); if(t)return e.preventDefault(),S.type=t.dataset.db26Type,S.sel.clear(),S.open.clear(),render();
  if(e.target.closest("[data-db26-editor]"))return e.preventDefault(),S.edit=!S.edit,render();
  let cat=e.target.closest("[data-db26-cat]"); if(cat){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();toggleFold(cat);return}
  let subb=e.target.closest("[data-db26-sub]"); if(subb){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();toggleSub(subb);return}
  let ca=e.target.closest("[data-db26-card]"); if(ca){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();card(ca.dataset.db26Card);return}
  if(e.target.closest("[data-db26-toggle]")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();toggleAll();return}
  if(e.target.closest("[data-db26-selall]"))return e.preventDefault(),rows().forEach(x=>S.sel.add(x.id)),render();
  if(e.target.closest("[data-db26-clear]"))return e.preventDefault(),S.sel.clear(),render();
  if(e.target.closest("[data-db26-add]"))return e.preventDefault(),add();
  if(e.target.closest("[data-db26-del]"))return e.preventDefault(),del();
  if(e.target.closest("[data-db26-hardclear]")){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();hardClearBase();return}
  if(e.target.closest("[data-db26-move]"))return e.preventDefault(),move();
  if(e.target.closest("[data-db26-copysrv]"))return e.preventDefault(),copySrv();
  if(e.target.closest("[data-db26-export]"))return e.preventDefault(),exp();
  if(e.target.closest("[data-db26-openimport]"))return e.preventDefault(),importModal();
  if(e.target.closest("[data-db264-autosort]"))return e.preventDefault(),autoSortStorage(true),render();
}
function change(e){
  if(!e.target.closest?.("#ep-db-v26"))return;
  let ch=e.target.closest("[data-db26-check]"); if(ch){ch.checked?S.sel.add(ch.dataset.db26Check):S.sel.delete(ch.dataset.db26Check);return}
  let cc=e.target.closest("[data-db26-catcheck]"); if(cc){let cat=cc.dataset.db26Cat.split("|").slice(2).join("|");rows().filter(x=>x.category===cat).forEach(x=>cc.checked?S.sel.add(x.id):S.sel.delete(x.id));render();return}
  let sc=e.target.closest("[data-db26-subcheck]"); if(sc){let p=sc.dataset.db26Sub.split("|"),cat=p[2],sub=p.slice(3).join("|");rows().filter(x=>x.category===cat&&x.subcategory===sub).forEach(x=>sc.checked?S.sel.add(x.id):S.sel.delete(x.id));render();return}
  let f=e.target.closest("[data-db26-import]"); if(f){imp(f.files&&f.files[0]);f.value="";return}
}
function input(e){let q=e.target.closest?.("#ep-db-v26 [data-db26-search]");if(q){S.q=q.value||"";render()}}


function hardDbAliases(){
  [
    "openDatabase","openDB","openDb","showDatabase","showDB","showDb",
    "openDatabaseScreen","showDatabaseScreen","renderDatabase",
    "openDatabasePage","openDbPage","openNewDatabase","openDatabaseManager",
    "openDatabaseV24","openDbV24","openDBV24","openDatabaseV243",
    "openMonolithDatabase","openMonolithicDatabase"
  ].forEach(name=>{
    try{
      window[name]=function(...args){
        open();
        return true;
      };
      window[name].__db2641HardAlias=true;
    }catch(e){}
  });

  try{
    window.DB_OPEN=open;
    window.EP_OPEN_DATABASE=open;
    window.__electricProOpenDatabase=open;
  }catch(e){}
}

function boot(){css();migrate();patchRouters();hardDbAliases();fixBurgerBadge();try{window.DatabaseV26SurgicalMonolith.version=V}catch(e){}}
function observe(){if(window.__db264Observer)return;let o=new MutationObserver(()=>{clearTimeout(window.__db264Timer);window.__db264Timer=setTimeout(()=>{patchRouters();fixBurgerBadge()},120)});o.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["class","style"]});window.__db264Observer=o}

window.DatabaseV26SurgicalMonolith={version:V,open,close,base,save,autoSort:autoSortStorage,exportJson:exp,markCleared,isCleared,unmarkCleared};
window.addEventListener("click",click,true);
window.addEventListener("change",change,true);
window.addEventListener("input",input,true);
window.addEventListener("DOMContentLoaded",()=>{boot();observe();[120,300,700,1500,3000].forEach(ms=>setTimeout(boot,ms))});
log("ready","БД V26.4 Smart Sort/Edit/Import загружена");
})();
