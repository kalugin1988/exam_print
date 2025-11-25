require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Подключение к PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

// Проверка подключения к базе
pool.connect((err, client, release) => {
  if (err) {
    console.error('Ошибка подключения к базе данных:', err.stack);
  } else {
    console.log('Успешное подключение к PostgreSQL');
    release();
  }
});

// Настройка EJS для шаблонов
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Главная страница - форма выбора параметров
app.get('/', async (req, res) => {
  try {
    // Получаем список кабинетов
    const classroomsResult = await pool.query(`
      SELECT DISTINCT "номер_кабинета" 
      FROM "Ученики" 
      WHERE "номер_кабинета" IS NOT NULL 
      ORDER BY "номер_кабинета"
    `);
    
    // Получаем список предметов
    const subjectsResult = await pool.query(`
      SELECT DISTINCT "предмет" 
      FROM "Ученики" 
      WHERE "предмет" IS NOT NULL 
      ORDER BY "предмет"
    `);

    res.render('index', {
      classrooms: classroomsResult.rows,
      subjects: subjectsResult.rows
    });
  } catch (error) {
    console.error('Ошибка при загрузке данных:', error);
    res.status(500).send('Ошибка сервера');
  }
});

// Генерация ведомости для одной аудитории
app.get('/generate', async (req, res) => {
  try {
    const { classroom, subject, exam_date, site_code, all_classrooms } = req.query;
    
    if (!subject || !exam_date || !site_code) {
      return res.status(400).send('Не все обязательные поля заполнены');
    }

    // Если выбран режим "все аудитории"
    if (all_classrooms === 'true') {
      return generateForAllClassrooms(req, res);
    }

    // Режим одной аудитории
    if (!classroom) {
      return res.status(400).send('Не выбрана аудитория');
    }

    // Получаем учеников для выбранного кабинета и предмета
    const studentsResult = await pool.query(`
      SELECT 
        "фимилия" as "last_name",
        "имя" as "first_name",
        "отчество" as "middle_name",
        "номер_места" as "workplace",
        "паралель" as "parallel"
      FROM "Ученики" 
      WHERE "номер_кабинета" = $1 AND "предмет" = $2
      ORDER BY "номер_места"
    `, [classroom, subject]);

    const students = studentsResult.rows.map(student => ({
      fullName: `${student.last_name} ${student.first_name} ${student.middle_name || ''}`.trim(),
      workplace: student.workplace,
      parallel: student.parallel,
      sheets: '', // оставляем пустым для ручного заполнения
      signature: '' // оставляем пустым для ручного заполнения
    }));

    // Заполняем до 15 строк
    while (students.length < 15) {
      students.push({
        fullName: '',
        workplace: '',
        parallel: '',
        sheets: '',
        signature: ''
      });
    }

    res.render('statement', {
      subject: subject,
      exam_date: exam_date,
      site_code: site_code,
      classroom: classroom,
      students: students,
      title: `Ведомость для аудитории ${classroom}`
    });
  } catch (error) {
    console.error('Ошибка при генерации ведомости:', error);
    res.status(500).send('Ошибка сервера: ' + error.message);
  }
});

// Генерация ведомостей для всех аудиторий
async function generateForAllClassrooms(req, res) {
  try {
    const { subject, exam_date, site_code } = req.query;

    // Получаем все аудитории с учениками по выбранному предмету
    const classroomsResult = await pool.query(`
      SELECT DISTINCT "номер_кабинета" 
      FROM "Ученики" 
      WHERE "предмет" = $1 AND "номер_кабинета" IS NOT NULL
      ORDER BY "номер_кабинета"
    `, [subject]);

    if (classroomsResult.rows.length === 0) {
      return res.status(404).send('Не найдено аудиторий для выбранного предмета');
    }

    const statements = [];

    // Для каждой аудитории формируем ведомость
    for (const classroomRow of classroomsResult.rows) {
      const classroom = classroomRow.номер_кабинета;
      
      const studentsResult = await pool.query(`
        SELECT 
          "фимилия" as "last_name",
          "имя" as "first_name",
          "отчество" as "middle_name",
          "номер_места" as "workplace",
          "паралель" as "parallel"
        FROM "Ученики" 
        WHERE "номер_кабинета" = $1 AND "предмет" = $2
        ORDER BY "номер_места"
      `, [classroom, subject]);

      const students = studentsResult.rows.map(student => ({
        fullName: `${student.last_name} ${student.first_name} ${student.middle_name || ''}`.trim(),
        workplace: student.workplace,
        parallel: student.parallel,
        sheets: '',
        signature: ''
      }));

      // Заполняем до 15 строк
      while (students.length < 15) {
        students.push({
          fullName: '',
          workplace: '',
          parallel: '',
          sheets: '',
          signature: ''
        });
      }

      statements.push({
        subject: subject,
        exam_date: exam_date,
        site_code: site_code,
        classroom: classroom,
        students: students,
        title: `Ведомость для аудитории ${classroom}`
      });
    }

    res.render('all-statements', {
      statements: statements,
      subject: subject,
      exam_date: exam_date,
      site_code: site_code
    });
  } catch (error) {
    console.error('Ошибка при генерации ведомостей для всех аудиторий:', error);
    res.status(500).send('Ошибка сервера: ' + error.message);
  }
}

// Генерация общей ведомости учета олимпиадных работ
app.get('/general-statement', async (req, res) => {
  try {
    const { subject, exam_date, site_code } = req.query;
    
    if (!subject || !exam_date || !site_code) {
      return res.status(400).send('Не все обязательные поля заполнены');
    }

    // Получаем данные по аудиториям и параллелям
    const classroomsData = await pool.query(`
      SELECT 
        "номер_кабинета",
        "паралель",
        COUNT(*) as "planned_count"
      FROM "Ученики" 
      WHERE "предмет" = $1 
      GROUP BY "номер_кабинета", "паралель"
      ORDER BY "номер_кабинета", "паралель"
    `, [subject]);

    const rows = classroomsData.rows.map(row => ({
      classroom: row.номер_кабинета,
      parallel: row.паралель,
      planned: row.planned_count,
      actual: '', // оставляем пустым для ручного заполнения
      responsible: '', // оставляем пустым для ручного заполнения
      signature: '' // оставляем пустым для ручного заполнения
    }));

    // Заполняем до 15 строк
    while (rows.length < 15) {
      rows.push({
        classroom: '',
        parallel: '',
        planned: '',
        actual: '',
        responsible: '',
        signature: ''
      });
    }

    res.render('general-statement', {
      subject: subject,
      exam_date: exam_date,
      site_code: site_code,
      rows: rows
    });
  } catch (error) {
    console.error('Ошибка при генерации общей ведомости:', error);
    res.status(500).send('Ошибка сервера: ' + error.message);
  }
});

// Генерация акта приема-передачи
app.get('/transfer-act', async (req, res) => {
  try {
    const { subject, exam_date, site_code } = req.query;
    
    if (!subject || !exam_date || !site_code) {
      return res.status(400).send('Не все обязательные поля заполнены');
    }

    // Получаем данные по аудиториям и параллелям для олимпиадных работ
    const worksData = await pool.query(`
      SELECT 
        "паралель",
        "номер_кабинета",
        COUNT(*) as "work_count"
      FROM "Ученики" 
      WHERE "предмет" = $1 
      GROUP BY "паралель", "номер_кабинета"
      ORDER BY "паралель", "номер_кабинета"
    `, [subject]);

    // Группируем по параллелям для итогов
    const parallelTotals = await pool.query(`
      SELECT 
        "паралель",
        COUNT(*) as "total_count"
      FROM "Ученики" 
      WHERE "предмет" = $1 
      GROUP BY "паралель"
      ORDER BY "паралель"
    `, [subject]);

    const worksRows = worksData.rows.map(row => ({
      parallel: row.паралель,
      classroom: row.номер_кабинета,
      count: row.work_count
    }));

    // Заполняем до 15 строк для работ
    while (worksRows.length < 15) {
      worksRows.push({
        parallel: '',
        classroom: '',
        count: ''
      });
    }

    const parallelTotalsRows = parallelTotals.rows.map(row => ({
      parallel: row.паралель,
      total: row.total_count
    }));

    // Заполняем до 15 строк для итогов
    while (parallelTotalsRows.length < 15) {
      parallelTotalsRows.push({
        parallel: '',
        total: ''
      });
    }

    res.render('transfer-act', {
      subject: subject,
      exam_date: exam_date,
      site_code: site_code,
      worksRows: worksRows,
      parallelTotals: parallelTotalsRows
    });
  } catch (error) {
    console.error('Ошибка при генерации акта приема-передачи:', error);
    res.status(500).send('Ошибка сервера: ' + error.message);
  }
});

// API для получения предметов по кабинету
app.get('/api/subjects/:classroom', async (req, res) => {
  try {
    const { classroom } = req.params;
    
    const result = await pool.query(`
      SELECT DISTINCT "предмет" 
      FROM "Ученики" 
      WHERE "номер_кабинета" = $1 AND "предмет" IS NOT NULL 
      ORDER BY "предмет"
    `, [classroom]);

    res.json(result.rows.map(row => row.предмет));
  } catch (error) {
    console.error('Ошибка при получении предметов:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// API для получения всех предметов (для режима всех аудиторий)
app.get('/api/all-subjects', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT "предмет" 
      FROM "Ученики" 
      WHERE "предмет" IS NOT NULL 
      ORDER BY "предмет"
    `);

    res.json(result.rows.map(row => row.предмет));
  } catch (error) {
    console.error('Ошибка при получении всех предметов:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:3000`);
});