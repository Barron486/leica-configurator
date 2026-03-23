const express = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

// Role-based price field filtering
function getPriceFields(role) {
  switch (role) {
    case 'admin':
      return 'p.cost_price, p.min_sell_price, p.suggested_price, p.retail_price';
    case 'sales':
      return 'p.min_sell_price, p.suggested_price, p.retail_price';
    default: // customer
      return 'p.retail_price';
  }
}

router.get('/', (req, res) => {
  const role = req.user?.role || 'customer';
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      pr.id, pr.catalog_number, pr.name_zh, pr.name_en,
      pr.category, pr.is_base_unit, pr.is_included_in_base,
      pr.description, pr.notes, pr.sort_order,
      p.cost_price, p.min_sell_price, p.suggested_price, p.retail_price, p.currency
    FROM products pr
    LEFT JOIN pricing p ON p.product_id = pr.id
    WHERE pr.active = 1
    ORDER BY pr.sort_order
  `).all();

  db.close();

  // Filter price fields based on role
  const filtered = rows.map(r => {
    const out = {
      id: r.id,
      catalog_number: r.catalog_number,
      name_zh: r.name_zh,
      name_en: r.name_en,
      category: r.category,
      is_base_unit: r.is_base_unit === 1,
      is_included_in_base: r.is_included_in_base === 1,
      description: r.description,
      notes: r.notes,
      sort_order: r.sort_order,
      currency: r.currency || 'TWD',
    };

    if (role === 'admin') {
      out.cost_price = r.cost_price;
      out.min_sell_price = r.min_sell_price;
      out.suggested_price = r.suggested_price;
      out.retail_price = r.retail_price;
    } else if (role === 'sales') {
      out.min_sell_price = r.min_sell_price;
      out.suggested_price = r.suggested_price;
      out.retail_price = r.retail_price;
    } else {
      out.retail_price = r.retail_price;
    }

    return out;
  });

  res.json(filtered);
});

module.exports = router;
