from fastapi import APIRouter, Depends, HTTPException
from pydantic.networks import EmailStr

from app.api.deps import get_current_active_superuser
from app.core.config import settings
from app.models import Message
from app.utils import generate_test_email, send_email

router = APIRouter(prefix="/utils", tags=["utils"])


@router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Send a test email, so an admin can check the SMTP relay from the app.
    """
    # Same guard as password recovery: without SMTP configured send_email can
    # only trip its assertion, and a 500 tells the admin nothing about why.
    if not settings.emails_enabled:
        raise HTTPException(
            status_code=503,
            detail="E-mail is not configured on this server (SMTP_HOST / EMAILS_FROM_EMAIL)",
        )

    email_data = generate_test_email(email_to=email_to)
    result = send_email(
        email_to=email_to,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )
    # A test button that reports success no matter what tests nothing, so a
    # relay that refuses the message is surfaced with the reason it gave.
    if not result.success:
        raise HTTPException(
            status_code=502,
            detail=f"The mail relay refused the message: {result.detail}",
        )
    return Message(message=f"Test email sent to {email_to}")


@router.get("/health-check/")
async def health_check() -> bool:
    return True
