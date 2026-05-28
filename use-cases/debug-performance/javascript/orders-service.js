// orders-service.js
const { Pool } = require("pg");

// Database connection - use environment variables with fallbacks
const pool = new Pool({
  user: process.env.DB_USER || "app_user",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "ecommerce",
  password: process.env.DB_PASSWORD || "password123",
  port: parseInt(process.env.DB_PORT || "5432"),
});

// Log connection info when service starts
console.log(
  `Database connection: ${process.env.DB_USER || "app_user"}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME || "ecommerce"}`,
);

async function getCustomerOrderDetails(customerId, startDate, endDate) {
  try {
    // Query to get all order details for a customer
    const result = await pool.query(
      `
          WITH filtered_orders AS (
            SELECT
              o.order_id,
              o.order_date,
              o.total_amount,
              o.status,
              o.customer_id,
              o.shipping_address_id
            FROM orders o
            WHERE o.customer_id = $1
              AND o.order_date BETWEEN $2 AND $3
            ORDER BY o.order_date DESC
     ----- offset based pagination
            LIMIT $4
            OFFSET $5
          ),

          order_items_agg AS (
            SELECT
              oi.order_id,
              json_agg(
                json_build_object(
                  'product_id', p.product_id,
                  'product_name', p.name,
                  'quantity', oi.quantity,
                  'unit_price', p.price,
                  'subtotal', (oi.quantity * p.price)
              )
            ) AS items
          FROM order_items oi
          JOIN products p
            ON oi.product_id = p.product_id
          JOIN filtered_orders fo
            ON oi.order_id = fo.order_id
          GROUP BY oi.order_id
        ),

        status_history_agg AS (
          SELECT
          s.order_id,
          json_agg(
            json_build_object(
              'status', s.status,
              'date', s.status_date,
              'notes', s.notes
            )
            ORDER BY s.status_date DESC
          ) AS status_history
      FROM order_status_history s
      JOIN filtered_orders fo
        ON s.order_id = fo.order_id
      GROUP BY s.order_id
    )

    SELECT
      fo.order_id,
      fo.order_date,
      fo.total_amount,
      fo.status,

      c.customer_name,
      c.email,

      oi.items,

      sh.status_history,

    a.street,
    a.city,
    a.state,
    a.postal_code,
    a.country

  FROM filtered_orders fo

  JOIN customers c
    ON fo.customer_id = c.customer_id

  LEFT JOIN addresses a
    ON fo.shipping_address_id = a.address_id

  LEFT JOIN order_items_agg oi
    ON fo.order_id = oi.order_id

  LEFT JOIN status_history_agg sh
    ON fo.order_id = sh.order_id

  ORDER BY fo.order_date DESC;`,
      // added offset based pagination that way the db loads and process less data, which results in faster queries, but also we send
      // few data over the wire to the user, so the request/response cycyle is faster.
      [customerId, startDate, endDate, limit, offset],
    );

    return result.rows;
  } catch (err) {
    console.error("Database query error:", err);
    throw err;
  }
}

// Example usage in Express route handler
async function getOrdersHandler(req, res) {
  try {
    const { customerId, limit, offset } = req.params;
    const { startDate = "2023-01-01", endDate = "2023-12-31" } = req.query;

    const orders = await getCustomerOrderDetails(customerId, startDate, endDate, limit, offset);

    res.json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Error in getOrdersHandler:", error);
    res.status(500).json({
      success: false,
      error: "An error occurred while fetching orders",
    });
  }
}

module.exports = {
  getCustomerOrderDetails,
  getOrdersHandler,
};

