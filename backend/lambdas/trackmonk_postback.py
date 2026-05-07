import json
import pymysql
import datetime

def lambda_handler(event, context):
    """
    Webhook de Clip - se llama cuando el pago se completa.
    Activa el plan de la empresa.
    """
    print("Postback event:", json.dumps(event))
    
    # Clip envía el body como string
    body = event.get('body', event)
    if isinstance(body, str):
        body = json.loads(body)
    
    payment_request_id = body.get('payment_request_id', '')
    status = body.get('status', '')
    
    if not payment_request_id:
        return {'statusCode': 400, 'body': 'Missing payment_request_id'}
    
    conn = pymysql.connect(
        host='18.234.77.182',
        user='operador',
        password='operador01',
        database='trackmonk_v2'
    )
    
    with conn.cursor() as cur:
        # Buscar el pago
        cur.execute("SELECT id, company_id, plan FROM payments WHERE clip_id=%s", (payment_request_id,))
        result = cur.fetchone()
        
        if not result:
            conn.close()
            return {'statusCode': 404, 'body': 'Payment not found'}
        
        payment_id, company_id, plan = result
        
        if status in ('completed', 'COMPLETED', 'approved', 'APPROVED'):
            # Activar plan
            plan_config = {
                'basic': {'max_devices': 5, 'days': 30},
                'pro': {'max_devices': 20, 'days': 30},
                'enterprise': {'max_devices': 999, 'days': 30},
            }
            
            config = plan_config.get(plan, {'max_devices': 5, 'days': 30})
            expires = datetime.datetime.now() + datetime.timedelta(days=config['days'])
            
            # Actualizar empresa
            cur.execute(
                "UPDATE companies SET plan=%s, max_devices=%s, expires_at=%s, demo_until=NULL WHERE id=%s",
                (plan, config['max_devices'], expires.strftime('%Y-%m-%d'), company_id)
            )
            
            # Marcar pago como completado
            cur.execute(
                "UPDATE payments SET status='completed', completed_at=NOW() WHERE id=%s",
                (payment_id,)
            )
            
            conn.commit()
            print(f"Plan {plan} activado para empresa {company_id} hasta {expires}")
        else:
            # Pago fallido o cancelado
            cur.execute("UPDATE payments SET status=%s WHERE id=%s", (status, payment_id))
            conn.commit()
    
    conn.close()
    return {'statusCode': 200, 'body': json.dumps({'success': True})}
